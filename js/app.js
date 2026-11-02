/*
 * app.js — Initialisation : relie le store et l'interface.
 */
(function (global) {
  'use strict';

  var Notes = global.Notes;

  var bannerTimer = null;

  /**
   * Affiche un message en haut de la grille.
   * @param {string} message
   * @param {string} [kind]      info | success | warn | error
   * @param {Array}  [actions]   [{ label, onClick }] boutons d'action
   * @param {number} [autoHide]  masquage automatique après n ms
   */
  function showBanner(message, kind, actions, autoHide) {
    var b = document.getElementById('banner');
    clearTimeout(bannerTimer);
    b.textContent = '';
    b.className = 'banner banner-' + (kind || 'info');
    var txt = document.createElement('span');
    txt.className = 'banner-text';
    txt.textContent = message;
    b.appendChild(txt);
    (actions || []).forEach(function (a) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'banner-btn';
      btn.textContent = a.label;
      btn.addEventListener('click', function () { hideBanner(); a.onClick(); });
      b.appendChild(btn);
    });
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'banner-close';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Fermer le message');
    close.addEventListener('click', hideBanner);
    b.appendChild(close);
    b.hidden = false;
    if (autoHide) bannerTimer = setTimeout(hideBanner, autoHide);
  }

  function hideBanner() {
    clearTimeout(bannerTimer);
    document.getElementById('banner').hidden = true;
  }

  function start() {
    var store;
    try {
      // Sur un poste verrouillé, localStorage peut être indisponible en file://
      if (!global.localStorage) throw new Error('localStorage absent');
      var saveErrorShown = false;
      store = Notes.createStore({
        onSaveError: function (e) {
          if (saveErrorShown) return;
          saveErrorShown = true;
          showBanner('Enregistrement impossible (stockage du navigateur plein ou bloqué) : '
            + 'exporte tes notes tout de suite via le menu ⋮. (' + e.message + ')', 'error');
        }
      });
      var res = store.load();
      if (!res.ok) {
        showBanner('Les notes enregistrées étaient illisibles. Une copie de secours a été '
          + 'conservée (' + res.backupKey + '). L\'appli repart d\'une liste vide.', 'warn');
      }
    } catch (e) {
      showBanner('Impossible d\'accéder au stockage du navigateur : les notes ne peuvent pas '
        + 'être enregistrées. (' + e.message + ')', 'error');
      return;
    }

    var editor = Notes.createEditor({
      store: store,
      overlay: document.getElementById('overlay'),
      onDeleted: function (snapshot) {
        var title = snapshot.note.title ? ' « ' + snapshot.note.title + ' »' : '';
        showBanner('Note' + title + ' supprimée.', 'info', [{
          label: 'Annuler',
          onClick: function () { store.restoreNote(snapshot); }
        }], 10000);
      },
      onArchived: function (id, archived) {
        showBanner(archived ? 'Note archivée.' : 'Note désarchivée.', 'info', [{
          label: 'Annuler',
          onClick: function () { store.setArchived(id, !archived); }
        }], 10000);
      }
    });

    var ui = Notes.createUI({
      store: store,
      grid: document.getElementById('grid'),
      emptyState: document.getElementById('empty-state'),
      filters: document.getElementById('filters'),
      onOpenNote: editor.open
    });

    var gridDrag = Notes.enableGridDrag({ store: store, ui: ui });

    // Taille des stickers : appliquée sur <body>, la grille se replace ; le menu reste ouvert
    // pour comparer les tailles.
    function applyCardSize(size) {
      document.body.dataset.cardSize = size;
      Array.prototype.forEach.call(document.querySelectorAll('.size-opt'), function (b) {
        var on = b.dataset.size === size;
        b.classList.toggle('active', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      });
      ui.layout();
    }
    document.querySelector('.size-picker').addEventListener('click', function (e) {
      var b = e.target.closest('.size-opt');
      if (!b) return;
      store.setCardSize(b.dataset.size);
      applyCardSize(b.dataset.size);
    });
    applyCardSize(store.getCardSize());

    // Recherche : filtre en direct ; Échap vide le champ ; « / » donne le focus
    var search = document.getElementById('search');
    search.addEventListener('input', function () { ui.setFilter({ query: search.value }); });
    search.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { search.value = ''; ui.setFilter({ query: '' }); search.blur(); }
    });
    document.addEventListener('keydown', function (e) {
      var t = e.target;
      var typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
      var dialogOpen = document.querySelector('.dialog-overlay:not([hidden])');
      if (e.key === '/' && !typing && !editor.isOpen() && !dialogOpen) { e.preventDefault(); search.focus(); }
    });

    // Appli ouverte dans deux onglets : quand l'autre onglet enregistre, on recharge ici
    // (sinon le prochain enregistrement de cet onglet écraserait ses modifications).
    global.addEventListener('storage', function (e) {
      if (e.key !== 'notes-app-v1') return;
      if (editor.isOpen()) editor.close({ skipFinalize: true });
      store.load();
      refresh();
      showBanner('Notes mises à jour depuis un autre onglet.', 'info', null, 5000);
    });

    var panel = Notes.createPanel({
      store: store,
      root: document.getElementById('panel'),
      onOpen: function (noteId, itemId) { editor.open(noteId, { focusItemId: itemId }); }
    });

    var backup = Notes.createBackup({ store: store, showBanner: showBanner });
    var clock = Notes.createClock({ root: document.getElementById('clock') });
    var fileSync = Notes.createFileSync({
      store: store,
      showBanner: showBanner,
      confirmDialog: backup.confirmDialog,
      onSaved: function () { backup.refreshReminder(); }
    });

    // Grille + panneau redessinés ensemble, au plus une fois par frame
    var refreshPending = false;
    function refresh() {
      if (refreshPending) return;
      refreshPending = true;
      requestAnimationFrame(function () {
        refreshPending = false;
        ui.render();
        panel.render();
        backup.refreshReminder();
      });
    }

    store.onChange(refresh);

    // L'urgence dépend de la date du jour : l'appli peut rester ouverte toute la
    // journée (ou passer minuit) → rafraîchissement régulier et au retour sur l'onglet.
    var lastDay = Notes.workdays.todayISO();
    function refreshIfNewDay() {
      var d = Notes.workdays.todayISO();
      if (d !== lastDay) { lastDay = d; refresh(); }
    }
    setInterval(refreshIfNewDay, 10 * 60 * 1000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) refreshIfNewDay();
    });

    document.getElementById('btn-new-note').addEventListener('click', function () {
      if (ui.getFilter().archived) ui.showArchives(false); // une nouvelle note n'est jamais archivée
      var note = store.addNote({ col: ui.shortestColumn() });
      editor.open(note.id);
    });

    ui.render();
    panel.render();
    backup.refreshReminder();

    // Accès console pour le débogage : Notes.app.store.getNotes()
    Notes.app = { store: store, ui: ui, editor: editor, panel: panel, backup: backup, gridDrag: gridDrag, clock: clock, fileSync: fileSync };
  }

  document.addEventListener('DOMContentLoaded', start);
})(window);
