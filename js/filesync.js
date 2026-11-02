/*
 * filesync.js — Sauvegarde automatique dans un fichier choisi par l'utilisateur
 * (ex. Documents\Notes\notes.json, ou G:\Mon Drive\Notes\notes.json avec Google Drive
 * pour ordinateur, qui se charge alors de la synchronisation avec le compte Google).
 *
 * L'appli reste 100 % hors ligne : elle n'écrit que sur le disque, via l'API
 * « File System Access » d'Edge / Chrome. Le fichier choisi est mémorisé (IndexedDB).
 *
 *  - écriture ~1 s après chaque modification (écritures regroupées, jamais simultanées) ;
 *  - si Edge redemande l'autorisation (nouvelle session), la sauvegarde passe « en pause »
 *    jusqu'à un clic sur « Reprendre » ;
 *  - « Ouvrir un fichier existant » permet de restaurer après une réinitialisation d'Edge.
 *
 * Expose : window.Notes.createFileSync({ store, showBanner, confirmDialog, onSaved })
 *          window.Notes.fileSyncPlan(text, currentNoteCount)  (logique pure, testée)
 */
(function (global) {
  'use strict';

  var Notes = global.Notes || (global.Notes = {});
  var DEBOUNCE_MS = 1000;
  var JSON_TYPES = [{ description: 'Sauvegarde Notes (JSON)', accept: { 'application/json': ['.json'] } }];

  // ---------------------------------------------------------------- logique pure

  /**
   * Que faire du contenu d'un fichier qu'on vient d'ouvrir ?
   * @returns {{action:string, count?:number, errors?:string[], data?:Object}}
   *   'empty'   : fichier vide → on y écrira les notes actuelles
   *   'invalid' : pas une sauvegarde valide → refus
   *   'load'    : sauvegarde valide et appli vide → chargement direct
   *   'confirm' : sauvegarde valide et appli non vide → demander avant de remplacer
   */
  function fileSyncPlan(text, currentNoteCount) {
    if (!text || !text.trim()) return { action: 'empty' };
    var data;
    try { data = JSON.parse(text); } catch (e) {
      return { action: 'invalid', errors: ['ce n\'est pas un fichier JSON lisible'] };
    }
    var v = Notes.validateBackup(data);
    if (!v.ok) return { action: 'invalid', errors: v.errors };
    return { action: currentNoteCount ? 'confirm' : 'load', count: v.count, data: data };
  }

  // ---------------------------------------------------------------- mémorisation du fichier (IndexedDB)

  var idbHandleStore = {
    _db: null,
    _open: function () {
      var self = this;
      if (self._db) return Promise.resolve(self._db);
      return new Promise(function (resolve, reject) {
        var r = indexedDB.open('notes-app', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('fichiers'); };
        r.onsuccess = function () { self._db = r.result; resolve(r.result); };
        r.onerror = function () { reject(r.error); };
      });
    },
    _tx: function (mode, fn) {
      return this._open().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction('fichiers', mode);
          var req = fn(tx.objectStore('fichiers'));
          tx.oncomplete = function () { resolve(req && req.result); };
          tx.onerror = function () { reject(tx.error); };
        });
      });
    },
    get: function () { return this._tx('readonly', function (s) { return s.get('sauvegarde'); }); },
    set: function (h) { return this._tx('readwrite', function (s) { return s.put(h, 'sauvegarde'); }); },
    clear: function () { return this._tx('readwrite', function (s) { return s.delete('sauvegarde'); }); }
  };

  // ---------------------------------------------------------------- interface

  function createFileSync(opts) {
    var store = opts.store;
    var showBanner = opts.showBanner;
    var confirmDialog = opts.confirmDialog;
    var onSaved = opts.onSaved || function () {};
    var el = Notes.view.el;
    // Point d'injection pour les tests automatisés (fichiers simulés) ; sinon IndexedDB.
    var handles = global.__notesTestHandleStore || idbHandleStore;

    var section = document.getElementById('autosave-section');
    var statusEl = document.getElementById('autosave-status');
    var supported = typeof global.showSaveFilePicker === 'function'
      && typeof global.showOpenFilePicker === 'function';

    var handle = null;
    var state = 'off';        // off | active | paused | error
    var lastWrite = null;     // Date du dernier enregistrement réussi
    var timer = null;
    var writing = false;
    var again = false;        // une modification est arrivée pendant l'écriture

    function hhmm(d) { return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }

    // ---------------------------------------------------------- écriture

    function schedule() {
      if (!handle || state === 'off') return;
      clearTimeout(timer);
      timer = setTimeout(writeNow, DEBOUNCE_MS);
    }

    function writeNow() {
      clearTimeout(timer);
      if (!handle) return Promise.resolve(false);
      if (writing) { again = true; return Promise.resolve(false); }
      writing = true;
      return handle.queryPermission({ mode: 'readwrite' }).then(function (perm) {
        if (perm !== 'granted') { setState('paused'); return false; }
        return handle.createWritable().then(function (w) {
          return w.write(JSON.stringify(store.exportData(), null, 2))
            .then(function () { return w.close(); });
        }).then(function () {
          lastWrite = new Date();
          store.markExported();          // le rappel de sauvegarde n'a plus lieu d'être
          setState('active');
          onSaved();
          return true;
        });
      }).catch(function (e) {
        setState('error');
        showBanner('Sauvegarde automatique impossible dans « ' + handle.name + ' » : fichier déplacé, '
          + 'supprimé ou disque indisponible ? Choisis à nouveau le fichier dans le menu ⋮. (' + e.message + ')',
          'error');
        return false;
      }).then(function (ok) {
        writing = false;
        if (again) { again = false; schedule(); }
        return ok;
      });
    }

    // ---------------------------------------------------------- état et affichage

    function setState(s) {
      state = s;
      renderStatus();
      renderSection();
    }

    function renderStatus() {
      statusEl.textContent = '';
      statusEl.className = 'autosave-status';
      statusEl.hidden = state === 'off';
      if (state === 'active') {
        statusEl.textContent = lastWrite ? 'Enregistré ' + hhmm(lastWrite) : 'Sauvegarde auto active';
        statusEl.title = 'Sauvegarde automatique dans « ' + handle.name + ' »';
      } else if (state === 'paused') {
        var b = el('button', 'autosave-resume', 'Sauvegarde en pause · Reprendre');
        b.type = 'button';
        b.title = 'Edge demande l\'autorisation d\'écrire dans « ' + handle.name + ' »';
        b.addEventListener('click', resume);
        statusEl.appendChild(b);
        statusEl.classList.add('paused');
      } else if (state === 'error') {
        statusEl.textContent = 'Sauvegarde auto : erreur';
        statusEl.classList.add('error');
      }
    }

    function button(label, onClick, cls) {
      var b = el('button', 'menu-item' + (cls ? ' ' + cls : ''), label);
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.addEventListener('click', function () {
        var menu = document.getElementById('menu');          // referme le menu ⋮
        menu.hidden = true;
        document.getElementById('btn-menu').setAttribute('aria-expanded', 'false');
        onClick();
      });
      return b;
    }

    function renderSection() {
      section.textContent = '';
      section.appendChild(el('div', 'menu-label', 'Sauvegarde automatique dans un fichier'));
      if (!supported) {
        section.appendChild(el('div', 'menu-note', 'Non disponible dans ce navigateur (utiliser Edge ou Chrome).'));
        return;
      }
      if (!handle) {
        section.appendChild(button('Créer un fichier de sauvegarde…', chooseNew));
        section.appendChild(button('Ouvrir un fichier existant…', chooseExisting));
        return;
      }
      var info = state === 'active'
        ? (lastWrite ? 'Enregistré à ' + hhmm(lastWrite) : 'Active')
        : state === 'paused' ? 'En pause : autorisation à redonner' : 'Erreur d\'écriture';
      section.appendChild(el('div', 'menu-note', '« ' + handle.name + ' » — ' + info));
      if (state === 'paused') section.appendChild(button('Reprendre la sauvegarde', resume));
      if (state === 'error') section.appendChild(button('Réessayer', function () { setState('active'); writeNow(); }));
      section.appendChild(button('Changer de fichier…', chooseNew));
      section.appendChild(button('Arrêter la sauvegarde automatique', stop, 'menu-item-muted'));
    }

    // ---------------------------------------------------------- actions

    function attach(h, writeFirst) {
      handle = h;
      return handles.set(h).catch(function () { /* mémorisation impossible : actif pour la session */ })
        .then(function () {
          setState('active');
          if (writeFirst) return writeNow();
          return true;
        });
    }

    /** Nouveau fichier (ou fichier existant à écraser, Windows demande confirmation). */
    function chooseNew() {
      global.showSaveFilePicker({ suggestedName: 'notes.json', types: JSON_TYPES })
        .then(function (h) {
          return attach(h, true).then(function (ok) {
            if (ok) showBanner('Sauvegarde automatique activée dans « ' + h.name + ' ».', 'success', null, 6000);
          });
        })
        .catch(function (e) { if (e.name !== 'AbortError') showBanner('Choix du fichier impossible : ' + e.message, 'error'); });
    }

    /** Fichier existant : on propose de charger son contenu (restauration). */
    function chooseExisting() {
      var h;
      global.showOpenFilePicker({ types: JSON_TYPES, multiple: false })
        .then(function (list) {
          h = list[0];
          // l'écriture demande une autorisation explicite (clic en cours : c'est le bon moment)
          return h.requestPermission({ mode: 'readwrite' });
        })
        .then(function (perm) {
          if (perm !== 'granted') throw new Error('autorisation d\'écriture refusée');
          return h.getFile().then(function (f) { return f.text(); });
        })
        .then(function (text) {
          var plan = fileSyncPlan(text, store.getNotes().length);
          if (plan.action === 'invalid') {
            showBanner('« ' + h.name + ' » n\'est pas une sauvegarde valide : '
              + plan.errors.slice(0, 2).join(' ; '), 'error');
            return;
          }
          if (plan.action === 'empty') {
            return attach(h, true).then(function () {
              showBanner('Sauvegarde automatique activée dans « ' + h.name + ' ».', 'success', null, 6000);
            });
          }
          var go = plan.action === 'load' ? Promise.resolve(true) : confirmDialog({
            title: 'Charger les notes du fichier ?',
            message: 'Tes ' + store.getNotes().length + ' notes actuelles vont être remplacées par les '
              + plan.count + ' notes de « ' + h.name + ' ». Ce fichier deviendra ta sauvegarde automatique.',
            detail: 'Tu pourras annuler le chargement juste après.',
            confirmLabel: 'Charger'
          });
          return go.then(function (ok) {
            if (!ok) return;
            store.importData(plan.data);            // annulable (undoImport)
            return attach(h, false).then(function () {
              showBanner(plan.count + ' notes chargées depuis « ' + h.name + ' ». Sauvegarde automatique activée.',
                'success', store.getNotes().length && plan.action === 'confirm' ? [{
                  label: 'Annuler le chargement',
                  onClick: function () { store.undoImport(); }
                }] : null, 10000);
            });
          });
        })
        .catch(function (e) { if (e.name !== 'AbortError') showBanner('Ouverture impossible : ' + e.message, 'error'); });
    }

    /** Redonner l'autorisation (doit venir d'un clic). */
    function resume() {
      if (!handle) return;
      handle.requestPermission({ mode: 'readwrite' }).then(function (perm) {
        if (perm === 'granted') { setState('active'); writeNow(); }
        else showBanner('Sans autorisation, la sauvegarde automatique reste en pause.', 'warn', null, 6000);
      }).catch(function (e) { showBanner('Autorisation impossible : ' + e.message, 'error'); });
    }

    function stop() {
      clearTimeout(timer);
      handle = null;
      lastWrite = null;
      handles.clear().catch(function () {});
      setState('off');
      showBanner('Sauvegarde automatique arrêtée. Le fichier existant n\'a pas été supprimé.', 'info', null, 6000);
    }

    // ---------------------------------------------------------- démarrage

    store.onChange(schedule);

    // Dernière écriture si une modification est en attente à la fermeture de la page
    global.addEventListener('pagehide', function () { if (timer) writeNow(); });

    function init() {
      if (!supported) { renderSection(); renderStatus(); return Promise.resolve(); }
      return handles.get().then(function (h) {
        if (!h) { setState('off'); return; }
        handle = h;
        return h.queryPermission({ mode: 'readwrite' }).then(function (perm) {
          if (perm !== 'granted') { setState('paused'); return; }
          setState('active');
          // Navigateur réinitialisé mais fichier toujours mémorisé : appli vide → on recharge le fichier
          if (!store.getNotes().length) {
            return h.getFile().then(function (f) { return f.text(); }).then(function (text) {
              var plan = fileSyncPlan(text, 0);
              if (plan.action === 'load' && plan.count) {
                store.importData(plan.data);
                showBanner(plan.count + ' notes rechargées depuis « ' + h.name + ' ».', 'success', null, 8000);
              }
            });
          }
        });
      }).catch(function () { setState('off'); });
    }

    var ready = init();

    return {
      ready: ready,
      writeNow: writeNow,
      getState: function () { return state; },
      fileName: function () { return handle ? handle.name : null; }
    };
  }

  Notes.fileSyncPlan = fileSyncPlan;
  Notes.createFileSync = createFileSync;
})(window);
