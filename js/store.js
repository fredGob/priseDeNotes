/*
 * store.js — Couche données de l'appli de notes.
 *
 * Logique pure : aucun accès au DOM. Testable seule (tests/tests.html).
 * Script classique (pas de module ES) car l'appli tourne en file://.
 * Expose : window.Notes.createStore(options)
 *
 * Toutes les fonctions de lecture renvoient des COPIES : l'UI ne peut pas
 * modifier les données sans passer par les fonctions du store.
 */
(function (global) {
  'use strict';

  var Notes = global.Notes || (global.Notes = {});

  var DATA_VERSION = 1;
  var DEFAULT_KEY = 'notes-app-v1';
  var COLORS = ['default', 'yellow', 'green', 'blue', 'pink', 'purple', 'grey'];
  // text     : texte libre
  // task     : case à cocher simple (checklist)
  // deadline : tâche à délai (jours ouvrés), suivie dans le panneau de droite
  var ITEM_TYPES = ['text', 'task', 'deadline'];
  var CHECKABLE = ['task', 'deadline'];
  var CARD_SIZES = ['small', 'medium', 'large'];
  var MAX_DAYS = 365;
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  // ---------------------------------------------------------------- utilitaires

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function defaultGenId(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function defaultNow() {
    return new Date().toISOString();
  }

  /** Vrai si s est une date AAAA-MM-JJ existante (refuse 2026-02-30). */
  function isValidDate(s) {
    if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
    var p = s.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
  }

  /** Trim, suppression des vides, dédoublonnage insensible à la casse. */
  function normalizeTags(tags) {
    if (!Array.isArray(tags)) throw new Error('tags doit être un tableau');
    var seen = {};
    var out = [];
    tags.forEach(function (t) {
      if (typeof t !== 'string') return;
      var v = t.trim();
      var k = v.toLowerCase();
      if (v && !seen[k]) { seen[k] = true; out.push(v); }
    });
    return out;
  }

  function checkColor(color) {
    if (COLORS.indexOf(color) === -1) throw new Error('Couleur inconnue : ' + color);
    return color;
  }

  function checkText(text, label) {
    if (typeof text !== 'string') throw new Error(label + ' doit être une chaîne');
    return text;
  }

  function checkDays(days) {
    var n = Number(days);
    if (!Number.isInteger(n) || n < 1 || n > MAX_DAYS) {
      throw new Error('Délai invalide : nombre entier de jours ouvrés entre 1 et ' + MAX_DAYS + ' attendu');
    }
    return n;
  }

  /** Déplace l'élément d'index `from` vers `to` (borné), en place. */
  function moveInArray(arr, from, to) {
    var target = Math.max(0, Math.min(arr.length - 1, to));
    var el = arr.splice(from, 1)[0];
    arr.splice(target, 0, el);
  }

  // ---------------------------------------------------------------- store

  /**
   * @param {Object} [options]
   * @param {Storage} [options.storage]  objet type localStorage (getItem/setItem)
   * @param {string}  [options.key]      clé de stockage
   * @param {Function}[options.now]      () => horodatage ISO (injectable pour les tests)
   * @param {Function}[options.genId]    (prefix) => id unique (injectable pour les tests)
   * @param {Function}[options.today]    () => 'AAAA-MM-JJ' (injectable pour les tests)
   */
  function createStore(options) {
    options = options || {};
    var storage = options.storage || global.localStorage;
    var key = options.key || DEFAULT_KEY;
    var now = options.now || defaultNow;
    var genId = options.genId || defaultGenId;
    var WD = Notes.workdays; // workdays.js doit être chargé avant store.js
    var today = options.today || function () { return WD.todayISO(); };

    var state = { version: DATA_VERSION, notes: [] };
    var listeners = [];

    // ---- persistance

    function load() {
      var raw = storage.getItem(key);
      if (raw === null) {
        state = { version: DATA_VERSION, notes: [] };
        return { ok: true, empty: true };
      }
      try {
        var data = JSON.parse(raw);
        if (!data || !Array.isArray(data.notes)) throw new Error('format inattendu');
        state = { version: DATA_VERSION, notes: data.notes };
        renumber();
        return { ok: true, empty: false };
      } catch (e) {
        // Données illisibles : on les met de côté au lieu de les écraser.
        var backupKey = key + '-corrompu-' + now().replace(/[:.]/g, '-');
        storage.setItem(backupKey, raw);
        state = { version: DATA_VERSION, notes: [] };
        return { ok: false, backupKey: backupKey, error: e.message };
      }
    }

    function save() {
      try {
        storage.setItem(key, JSON.stringify(state));
      } catch (e) {
        // Stockage plein ou refusé : on prévient sans bloquer l'appli
        if (options.onSaveError) options.onSaveError(e);
        else throw e;
      }
      listeners.forEach(function (fn) { fn(); });
    }

    function onChange(fn) {
      listeners.push(fn);
      return function unsubscribe() {
        listeners = listeners.filter(function (l) { return l !== fn; });
      };
    }

    // ---- accès internes

    /** Trie par order puis réattribue 0..n-1 (garantit un ordre propre). */
    function renumber() {
      state.notes.sort(function (a, b) { return a.order - b.order; });
      state.notes.forEach(function (n, i) { n.order = i; });
    }

    function findNote(noteId) {
      for (var i = 0; i < state.notes.length; i++) {
        if (state.notes[i].id === noteId) return state.notes[i];
      }
      throw new Error('Note introuvable : ' + noteId);
    }

    function findItem(note, itemId) {
      for (var i = 0; i < note.items.length; i++) {
        if (note.items[i].id === itemId) return note.items[i];
      }
      throw new Error('Élément introuvable : ' + itemId);
    }

    function touch(note) {
      note.updatedAt = now();
    }

    // ---- notes

    function getNotes() {
      return clone(state.notes); // déjà triées par order
    }

    function getNote(noteId) {
      return clone(findNote(noteId));
    }

    /** Crée une note, placée en tête de grille (comme Keep). */
    function addNote(fields) {
      fields = fields || {};
      var ts = now();
      var note = {
        id: genId('n_'),
        title: checkText(fields.title !== undefined ? fields.title : '', 'title'),
        color: checkColor(fields.color || 'default'),
        tags: normalizeTags(fields.tags || []),
        archived: false,
        order: -1,
        items: [],
        createdAt: ts,
        updatedAt: ts
      };
      state.notes.push(note);
      renumber();
      save();
      return clone(note);
    }

    /** Modifie title / color / tags. Les autres champs sont refusés. */
    function updateNote(noteId, patch) {
      var note = findNote(noteId);
      Object.keys(patch).forEach(function (k) {
        if (k === 'title') note.title = checkText(patch.title, 'title');
        else if (k === 'color') note.color = checkColor(patch.color);
        else if (k === 'tags') note.tags = normalizeTags(patch.tags);
        else throw new Error('Champ non modifiable : ' + k);
      });
      touch(note);
      save();
      return clone(note);
    }

    /**
     * Supprime une note.
     * @returns {{note:Object, index:number}} instantané pour restoreNote (annulation)
     */
    function deleteNote(noteId) {
      var note = findNote(noteId);
      var index = state.notes.indexOf(note);
      state.notes.splice(index, 1);
      renumber();
      save();
      return { note: clone(note), index: index };
    }

    /** Remet une note supprimée à sa place (annulation de deleteNote). */
    function restoreNote(snapshot) {
      var n = snapshot.note;
      if (state.notes.some(function (x) { return x.id === n.id; })) {
        throw new Error('Note déjà présente : ' + n.id);
      }
      state.notes.splice(Math.max(0, Math.min(state.notes.length, snapshot.index)), 0, clone(n));
      state.notes.forEach(function (x, i) { x.order = i; });
      save();
      return clone(n);
    }

    /** Archive / désarchive une note (elle garde sa place dans l'ordre). */
    function setArchived(noteId, archived) {
      var note = findNote(noteId);
      note.archived = !!archived;
      touch(note);
      save();
      return clone(note);
    }

    /** Déplace une note à la position newIndex (0 = première). */
    function moveNote(noteId, newIndex) {
      var note = findNote(noteId);
      moveInArray(state.notes, state.notes.indexOf(note), newIndex);
      state.notes.forEach(function (n, i) { n.order = i; });
      save();
    }

    // ---- éléments (texte ou tâche)

    /**
     * Ajoute un élément. fields : { type, text, days }  (days : tâche à délai uniquement)
     * index (optionnel) : position d'insertion ; par défaut en fin de carte.
     *
     * Tâche à délai : start = aujourd'hui, due = start + days jours ouvrés.
     */
    function addItem(noteId, fields, index) {
      var note = findNote(noteId);
      fields = fields || {};
      var type = fields.type || 'text';
      if (ITEM_TYPES.indexOf(type) === -1) throw new Error('Type inconnu : ' + type);
      if (fields.days !== undefined && type !== 'deadline') {
        throw new Error('Un délai ne peut être posé que sur une tâche à délai');
      }

      var item = { id: genId('i_'), type: type, text: checkText(fields.text || '', 'text') };
      if (type === 'task') {
        item.done = false;
      } else if (type === 'deadline') {
        item.done = false;
        item.days = checkDays(fields.days);
        item.start = today();
        item.due = WD.addWorkingDays(item.start, item.days);
        item.doneAt = null;
      }
      if (typeof index === 'number') {
        note.items.splice(Math.max(0, Math.min(note.items.length, index)), 0, item);
      } else {
        note.items.push(item);
      }
      touch(note);
      save();
      return clone(item);
    }

    /**
     * Modifie text ; done (case à cocher / tâche à délai) ; days (tâche à délai :
     * l'échéance est recalculée depuis la date de début, qui ne change pas).
     */
    function updateItem(noteId, itemId, patch) {
      var note = findNote(noteId);
      var item = findItem(note, itemId);
      Object.keys(patch).forEach(function (k) {
        if (k === 'text') {
          item.text = checkText(patch.text, 'text');
        } else if (k === 'done') {
          if (CHECKABLE.indexOf(item.type) === -1) throw new Error('« done » réservé aux tâches');
          item.done = !!patch.done;
          if (item.type === 'deadline') item.doneAt = item.done ? today() : null;
        } else if (k === 'days') {
          if (item.type !== 'deadline') throw new Error('« days » réservé aux tâches à délai');
          item.days = checkDays(patch.days);
          item.due = WD.addWorkingDays(item.start, item.days);
        } else {
          throw new Error('Champ non modifiable : ' + k);
        }
      });
      touch(note);
      save();
      return clone(item);
    }

    function toggleTask(noteId, itemId) {
      var item = findItem(findNote(noteId), itemId);
      if (CHECKABLE.indexOf(item.type) === -1) throw new Error('Seule une tâche peut être cochée');
      return updateItem(noteId, itemId, { done: !item.done });
    }

    function deleteItem(noteId, itemId) {
      var note = findNote(noteId);
      var item = findItem(note, itemId);
      note.items.splice(note.items.indexOf(item), 1);
      touch(note);
      save();
    }

    function moveItem(noteId, itemId, newIndex) {
      var note = findNote(noteId);
      var item = findItem(note, itemId);
      moveInArray(note.items, note.items.indexOf(item), newIndex);
      touch(note);
      save();
    }

    /**
     * Appelé à la fermeture de l'éditeur : retire les éléments au texte vide,
     * puis supprime la note si elle n'a plus ni titre ni élément (comme Keep).
     * @returns {{deleted: boolean}}
     */
    function finalizeNote(noteId) {
      var note = findNote(noteId);
      var before = note.items.length;
      note.items = note.items.filter(function (i) { return i.text.trim() !== ''; });
      if (!note.title.trim() && note.items.length === 0) {
        deleteNote(noteId);
        return { deleted: true };
      }
      if (note.items.length !== before) { touch(note); save(); }
      return { deleted: false };
    }

    /**
     * Toutes les tâches à délai de toutes les cartes, pour le panneau de droite.
     * active : non terminées, la plus proche de l'échéance (ou en retard) en premier.
     * done   : terminées, la plus récemment terminée en premier.
     * Chaque entrée : { noteId, noteTitle, noteColor, item }
     */
    function getDeadlineTasks() {
      var active = [], done = [];
      state.notes.forEach(function (n) {
        if (n.archived) return; // une note archivée sort du panneau des tâches
        n.items.forEach(function (it) {
          if (it.type !== 'deadline') return;
          var entry = { noteId: n.id, noteTitle: n.title, noteColor: n.color, item: clone(it) };
          (it.done ? done : active).push(entry);
        });
      });
      active.sort(function (a, b) {
        if (a.item.due !== b.item.due) return a.item.due < b.item.due ? -1 : 1;
        return a.item.start < b.item.start ? -1 : (a.item.start > b.item.start ? 1 : 0);
      });
      done.sort(function (a, b) {
        var x = a.item.doneAt || '', y = b.item.doneAt || '';
        return x < y ? 1 : (x > y ? -1 : 0);
      });
      return { active: active, done: done };
    }

    // ---- sauvegarde : export / import

    var KEY_BEFORE_IMPORT = key + '-avant-import';
    var KEY_LAST_EXPORT = key + '-derniere-sauvegarde';
    var KEY_SNOOZE = key + '-rappel-reporte';
    var KEY_CARD_SIZE = key + '-taille';

    /** Objet à écrire dans le fichier de sauvegarde. */
    function exportData() {
      return {
        app: 'notes-app',
        version: DATA_VERSION,
        exportedAt: now(),
        notes: clone(state.notes)
      };
    }

    /**
     * Remplace toutes les notes par celles d'une sauvegarde validée.
     * L'état précédent est conservé pour pouvoir annuler (undoImport).
     * @returns le résultat de validateBackup (lève une Error si invalide)
     */
    function importData(data) {
      var v = validateBackup(data);
      if (!v.ok) throw new Error(v.errors[0]);
      storage.setItem(KEY_BEFORE_IMPORT, JSON.stringify(state));
      state = { version: DATA_VERSION, notes: v.notes };
      renumber();
      save();
      return v;
    }

    function canUndoImport() {
      return storage.getItem(KEY_BEFORE_IMPORT) !== null;
    }

    /** Revient aux notes d'avant le dernier import. */
    function undoImport() {
      var raw = storage.getItem(KEY_BEFORE_IMPORT);
      if (raw === null) throw new Error('Aucun import à annuler');
      var data = JSON.parse(raw);
      state = { version: DATA_VERSION, notes: data.notes };
      renumber();
      save();
      storage.removeItem(KEY_BEFORE_IMPORT);
    }

    /** Taille des stickers : 'small' | 'medium' | 'large' (défaut 'medium'). */
    function getCardSize() {
      var v = storage.getItem(KEY_CARD_SIZE);
      return CARD_SIZES.indexOf(v) === -1 ? 'medium' : v;
    }
    function setCardSize(size) {
      if (CARD_SIZES.indexOf(size) === -1) throw new Error('Taille inconnue : ' + size);
      storage.setItem(KEY_CARD_SIZE, size);
    }

    function markExported() { storage.setItem(KEY_LAST_EXPORT, today()); }
    function getLastExport() { return storage.getItem(KEY_LAST_EXPORT); }
    function snoozeReminder() { storage.setItem(KEY_SNOOZE, today()); }
    function getReminderSnooze() { return storage.getItem(KEY_SNOOZE); }

    /**
     * Étiquettes utilisées par les notes actives (ou archivées si archived = true),
     * sans doublon (casse ignorée, 1re graphie gardée), triées. → [{ tag, count }]
     */
    function getAllTags(archived) {
      var map = {};
      state.notes.forEach(function (n) {
        if (!!n.archived !== !!archived) return;
        n.tags.forEach(function (t) {
          var k = t.toLowerCase();
          if (!map[k]) map[k] = { tag: t, count: 0 };
          map[k].count += 1;
        });
      });
      return Object.keys(map).map(function (k) { return map[k]; })
        .sort(function (a, b) { return a.tag.localeCompare(b.tag, 'fr', { sensitivity: 'base' }); });
    }

    return {
      load: load,
      getAllTags: getAllTags,
      exportData: exportData,
      importData: importData,
      canUndoImport: canUndoImport,
      undoImport: undoImport,
      getCardSize: getCardSize,
      setCardSize: setCardSize,
      markExported: markExported,
      getLastExport: getLastExport,
      snoozeReminder: snoozeReminder,
      getReminderSnooze: getReminderSnooze,
      finalizeNote: finalizeNote,
      getDeadlineTasks: getDeadlineTasks,
      onChange: onChange,
      getNotes: getNotes,
      getNote: getNote,
      addNote: addNote,
      updateNote: updateNote,
      deleteNote: deleteNote,
      restoreNote: restoreNote,
      setArchived: setArchived,
      moveNote: moveNote,
      addItem: addItem,
      updateItem: updateItem,
      toggleTask: toggleTask,
      deleteItem: deleteItem,
      moveItem: moveItem
    };
  }

  // ---------------------------------------------------------------- validation d'une sauvegarde

  var MAX_ERRORS = 10;

  /**
   * Vérifie qu'un objet (fichier JSON lu) est une sauvegarde valide.
   * Validation stricte : on ne restaure jamais un fichier douteux.
   * @returns {{ok:boolean, errors:string[], notes:Object[], count:number, exportedAt:string|null}}
   *   notes : copie normalisée, prête à être chargée
   */
  function validateBackup(data) {
    var errors = [];
    function err(msg) { if (errors.length < MAX_ERRORS) errors.push(msg); }
    var fail = function (msg) {
      return { ok: false, errors: [msg], notes: [], count: 0, exportedAt: null };
    };

    if (!data || typeof data !== 'object' || !Array.isArray(data.notes)) {
      return fail('Ce fichier n\'est pas une sauvegarde de l\'appli Notes.');
    }
    if (typeof data.version === 'number' && data.version > DATA_VERSION) {
      return fail('Sauvegarde créée par une version plus récente de l\'appli (v' + data.version + ').');
    }

    var noteIds = {}, itemIds = {};
    var isStr = function (x) { return typeof x === 'string'; };

    var notes = data.notes.map(function (n, i) {
      var where = 'Note ' + (i + 1) + (n && isStr(n.title) && n.title ? ' « ' + n.title + ' »' : '');
      if (!n || typeof n !== 'object') { err(where + ' : format invalide.'); return null; }

      if (!isStr(n.id) || !n.id) err(where + ' : identifiant manquant.');
      else if (noteIds[n.id]) err(where + ' : identifiant en double (' + n.id + ').');
      else noteIds[n.id] = true;

      if (!isStr(n.title)) err(where + ' : titre invalide.');
      if (COLORS.indexOf(n.color) === -1) err(where + ' : couleur inconnue (' + n.color + ').');
      if (!Array.isArray(n.tags) || !n.tags.every(isStr)) err(where + ' : étiquettes invalides.');
      if (n.archived !== undefined && typeof n.archived !== 'boolean') err(where + ' : état archivé invalide.');
      if (!Array.isArray(n.items)) { err(where + ' : liste d\'éléments manquante.'); return null; }

      n.items.forEach(function (it, j) {
        var w = where + ', élément ' + (j + 1);
        if (!it || typeof it !== 'object') { err(w + ' : format invalide.'); return; }
        if (!isStr(it.id) || !it.id) err(w + ' : identifiant manquant.');
        else if (itemIds[it.id]) err(w + ' : identifiant en double (' + it.id + ').');
        else itemIds[it.id] = true;
        if (ITEM_TYPES.indexOf(it.type) === -1) { err(w + ' : type inconnu (' + it.type + ').'); return; }
        if (!isStr(it.text)) err(w + ' : texte invalide.');
        if (it.type !== 'text' && typeof it.done !== 'boolean') err(w + ' : état coché invalide.');
        if (it.type === 'deadline') {
          if (!Number.isInteger(it.days) || it.days < 1 || it.days > MAX_DAYS) err(w + ' : délai invalide.');
          if (!isValidDate(it.start)) err(w + ' : date de début invalide.');
          if (!isValidDate(it.due)) err(w + ' : échéance invalide.');
          if (it.doneAt !== null && !isValidDate(it.doneAt)) err(w + ' : date de fin invalide.');
        }
      });

      return {
        id: n.id,
        title: n.title,
        color: n.color,
        tags: Array.isArray(n.tags) ? normalizeTags(n.tags) : [],
        archived: n.archived === true,
        order: typeof n.order === 'number' ? n.order : i,
        items: n.items,
        createdAt: isStr(n.createdAt) ? n.createdAt : '',
        updatedAt: isStr(n.updatedAt) ? n.updatedAt : ''
      };
    });

    if (errors.length) return { ok: false, errors: errors, notes: [], count: 0, exportedAt: null };
    return {
      ok: true,
      errors: [],
      notes: clone(notes),
      count: notes.length,
      exportedAt: isStr(data.exportedAt) ? data.exportedAt : null
    };
  }

  /**
   * Faut-il afficher le rappel de sauvegarde ?
   * - aucune note → non ; rappel reporté aujourd'hui → non ;
   * - jamais exporté → oui ; sinon oui si dernier export ≥ seuil jours calendaires.
   * @returns {{show:boolean, days:number|null}}  days = jours depuis le dernier export (null : jamais)
   */
  function backupReminder(o) {
    var threshold = o.threshold || 7;
    if (!o.noteCount || o.snoozedOn === o.today) return { show: false, days: null };
    if (!o.lastExport) return { show: true, days: null };
    var days = Notes.workdays.calendarDaysBetween(o.lastExport, o.today);
    return { show: days >= threshold, days: days };
  }

  // ---------------------------------------------------------------- filtre & recherche

  /** Minuscules sans accents, pour comparer « Réunion » et « reunion ». */
  function fold(s) {
    return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  /**
   * Filtre une liste de notes.
   * @param {Object[]} notes
   * @param {Object}   f  { tag: string|null, query: string, archived: boolean }
   *   archived : false (défaut) → notes actives ; true → notes archivées
   *   tag   : étiquette exacte (casse ignorée)
   *   query : tous les mots doivent apparaître (titre, éléments, étiquettes), accents ignorés
   */
  function filterNotes(notes, f) {
    f = f || {};
    var tag = f.tag ? f.tag.toLowerCase() : null;
    var words = fold(f.query || '').split(/\s+/).filter(Boolean);
    var archived = !!f.archived;
    return notes.filter(function (n) {
      if (!!n.archived !== archived) return false;
      if (tag && !n.tags.some(function (t) { return t.toLowerCase() === tag; })) return false;
      if (!words.length) return true;
      var hay = fold([n.title].concat(n.tags, n.items.map(function (i) { return i.text; })).join(' \n '));
      return words.every(function (w) { return hay.indexOf(w) !== -1; });
    });
  }

  /**
   * Après un glisser-déposer dans une grille éventuellement filtrée :
   * position cible (pour moveNote) dans la liste complète.
   * La carte se place juste avant sa nouvelle voisine visible suivante
   * (ou juste après la précédente si elle est en dernier).
   * @param {string[]} allIds      ordre complet actuel
   * @param {string[]} visibleIds  nouvel ordre des cartes visibles (avec la carte déplacée)
   * @param {string}   id          carte déplacée
   */
  function dropIndex(allIds, visibleIds, id) {
    var pos = visibleIds.indexOf(id);
    var without = allIds.filter(function (x) { return x !== id; });
    var next = visibleIds[pos + 1];
    var prev = visibleIds[pos - 1];
    if (next !== undefined) return without.indexOf(next);
    if (prev !== undefined) return without.indexOf(prev) + 1;
    return allIds.indexOf(id);
  }

  Notes.createStore = createStore;
  Notes.filterNotes = filterNotes;
  Notes.dropIndex = dropIndex;
  Notes.validateBackup = validateBackup;
  Notes.backupReminder = backupReminder;
  Notes.COLORS = COLORS.slice();
  Notes.MAX_DAYS = MAX_DAYS;
  Notes.isValidDate = isValidDate;
})(window);
