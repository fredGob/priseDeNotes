/*
 * editor.js — Éditeur de carte en modal (style Keep).
 *
 * - Clic sur une carte → la carte s'ouvre au centre de l'écran.
 * - Chaque frappe est enregistrée immédiatement via le store.
 * - Fermeture : Échap, clic hors de la carte, ou bouton « Fermer ».
 *   À la fermeture, les éléments vides sont retirés et une note vide est supprimée.
 *
 * Raccourcis dans une tâche :
 *   Entrée            → nouvelle tâche en dessous (coupe le texte au curseur)
 *   Retour arrière    → sur une ligne vide, la supprime et remonte
 *
 * Expose : window.Notes.createEditor({ store, overlay, onDeleted, onArchived })
 */
(function (global) {
  'use strict';

  var Notes = global.Notes || (global.Notes = {});

  function el(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // ---------------------------------------------------------------- zone de texte enrichi
  // Chaque ligne est un <div contenteditable> : gras / italique visibles pendant la saisie.
  // Les positions de curseur sont exprimées en caractères du texte VISIBLE (sans repères).

  var R = Notes.rich;

  function richValue(div) { return R.serialize(R.domToRuns(div)); }
  function richPlain(div) { return R.domToRuns(div).map(function (r) { return r.text; }).join(''); }

  /** Position (texte visible) d'un point du DOM (nœud + décalage) dans la zone. */
  function offsetOf(root, node, offset) {
    var pos = 0, found = false;
    function walk(n) {
      if (found) return;
      if (n === node && n.nodeType === 3) { pos += offset; found = true; return; }
      if (n === node) {                     // point entre des enfants d'un élément
        for (var k = 0; k < offset && k < n.childNodes.length; k++) walk(n.childNodes[k]);
        found = true; return;
      }
      if (n.nodeType === 3) { pos += n.nodeValue.length; return; }
      if (n.nodeName === 'BR') { pos += 1; return; }
      Array.prototype.forEach.call(n.childNodes, walk);
    }
    walk(root);
    return Math.min(pos, richPlain(root).length);
  }

  /** Sélection courante dans la zone → { start, end } (texte visible). */
  function getCaret(div) {
    var sel = global.getSelection();
    if (!sel || !sel.rangeCount || !div.contains(sel.anchorNode)) { var l = richPlain(div).length; return { start: l, end: l }; }
    var r = sel.getRangeAt(0);
    return { start: offsetOf(div, r.startContainer, r.startOffset), end: offsetOf(div, r.endContainer, r.endOffset) };
  }

  /** Place le curseur à la position `pos` du texte visible. */
  function setCaret(div, pos) {
    var range = document.createRange(), left = pos, done = false;
    (function walk(n) {
      if (done) return;
      if (n.nodeType === 3) {
        if (left <= n.nodeValue.length) { range.setStart(n, left); done = true; return; }
        left -= n.nodeValue.length; return;
      }
      if (n.nodeName === 'BR') {
        if (left === 0) { range.setStartBefore(n); done = true; return; }
        left -= 1; return;
      }
      Array.prototype.forEach.call(n.childNodes, walk);
    })(div);
    if (!done) { range.selectNodeContents(div); range.collapse(false); }
    range.collapse(true);
    var sel = global.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function focusEnd(input) {
    input.focus();
    var len = input.value.length;
    input.setSelectionRange(len, len);
  }

  function createEditor(opts) {
    var store = opts.store;
    var overlay = opts.overlay;
    var noteId = null;
    var lastFocus = null;
    var lastPoint = null;      // dernière position de curseur dans une ligne { itemId, caret }
    var pendingPoint = null;   // position mémorisée à l'ouverture du formulaire « tâche à délai »
    var onDeleted = opts.onDeleted || function () {};
    var onArchived = opts.onArchived || function () {};

    // ---------------------------------------------------------- structure fixe

    var box = el('div', 'editor');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Modifier la note');

    var titleInput = el('input', 'editor-title');
    titleInput.type = 'text';
    titleInput.placeholder = 'Titre';

    var itemsEl = el('div', 'editor-items');

    var addBar = el('div', 'editor-add');
    var btnAddText = el('button', 'btn-ghost', '+ Texte');
    var btnAddTask = el('button', 'btn-ghost', '+ Case à cocher');
    var btnAddDeadline = el('button', 'btn-ghost btn-deadline', '+ Tâche à délai');
    btnAddText.type = btnAddTask.type = btnAddDeadline.type = 'button';
    addBar.appendChild(btnAddText);
    addBar.appendChild(btnAddTask);
    addBar.appendChild(btnAddDeadline);

    // « Mode tâche » : formulaire de saisie d'une tâche à délai
    var dlForm = el('div', 'dl-form');
    dlForm.hidden = true;
    var dlText = el('input', 'dl-form-text');
    dlText.type = 'text';
    dlText.placeholder = 'Nouvelle tâche…';
    var dlDays = el('input', 'dl-form-days');
    dlDays.type = 'number';
    dlDays.min = 1;
    dlDays.max = Notes.MAX_DAYS;
    dlDays.value = 5;
    dlDays.setAttribute('aria-label', 'Délai en jours ouvrés');
    var dlUnit = el('span', 'dl-form-unit', 'jours ouvrés');
    var dlPreview = el('span', 'dl-form-preview');
    var dlOk = el('button', 'btn-primary btn-small', 'Valider');
    var dlCancel = el('button', 'btn-secondary btn-small', 'Annuler');
    dlOk.type = dlCancel.type = 'button';
    var dlError = el('div', 'dl-form-error');
    var dlLine = el('div', 'dl-form-line');
    [dlDays, dlUnit, dlPreview, dlOk, dlCancel].forEach(function (x) { dlLine.appendChild(x); });
    dlForm.appendChild(dlText);
    dlForm.appendChild(dlLine);
    dlForm.appendChild(dlError);

    // Palette de couleurs (style Keep) : une pastille par couleur
    var COLOR_NAMES = {
      'default': 'Par défaut', yellow: 'Jaune', green: 'Vert', blue: 'Bleu',
      pink: 'Rose', purple: 'Violet', grey: 'Gris'
    };
    var palette = el('div', 'editor-palette');
    palette.setAttribute('role', 'radiogroup');
    palette.setAttribute('aria-label', 'Couleur de la note');
    Notes.COLORS.forEach(function (c) {
      var sw = el('button', 'swatch color-' + c);
      sw.type = 'button';
      sw.dataset.color = c;
      sw.title = COLOR_NAMES[c] || c;
      sw.setAttribute('role', 'radio');
      sw.setAttribute('aria-label', COLOR_NAMES[c] || c);
      palette.appendChild(sw);
    });

    var footer = el('div', 'editor-footer');
    var btnArchive = el('button', 'btn-ghost', 'Archiver');
    var btnDelete = el('button', 'btn-danger', 'Supprimer');
    var btnClose = el('button', 'btn-secondary', 'Fermer');
    btnArchive.type = btnDelete.type = btnClose.type = 'button';
    footer.appendChild(palette);
    footer.appendChild(btnArchive);
    footer.appendChild(btnDelete);
    footer.appendChild(btnClose);

    box.appendChild(titleInput);
    // Étiquettes : pastilles supprimables + champ d'ajout avec suggestions
    var tagsRow = el('div', 'editor-tags');
    var tagsList = el('div', 'editor-tags-list');
    var tagInput = el('input', 'tag-input');
    tagInput.type = 'text';
    tagInput.placeholder = '+ Étiquette';
    tagInput.setAttribute('aria-label', 'Ajouter une étiquette');
    tagInput.setAttribute('list', 'tag-suggestions');
    var tagSuggest = el('datalist');
    tagSuggest.id = 'tag-suggestions';
    tagsRow.appendChild(tagsList);
    tagsRow.appendChild(tagInput);
    tagsRow.appendChild(tagSuggest);

    box.appendChild(itemsEl);
    box.appendChild(dlForm);
    box.appendChild(addBar);
    box.appendChild(tagsRow);
    box.appendChild(footer);
    overlay.appendChild(box);

    // ---------------------------------------------------------- rendu

    /**
     * Reconstruit la liste des éléments (après ajout / suppression).
     * La frappe simple ne passe PAS par ici, pour ne pas perdre le focus.
     * @param {Object} [focus]  { itemId, caret }  caret : position du curseur (défaut : fin)
     */
    function renderItems(focus) {
      var note = store.getNote(noteId);
      var today = Notes.workdays.todayISO();
      box.className = 'editor color-' + note.color;
      itemsEl.textContent = '';
      var toFocus = null;

      note.items.forEach(function (item) {
        // Ligne de texte : classe « editor-item-para » (et non « -text », déjà prise par la zone de saisie)
        var row = el('div', 'editor-item editor-item-' + (item.type === 'text' ? 'para' : item.type) + (item.done ? ' done' : ''));
        row.dataset.id = item.id;

        // Poignée de déplacement (glisser) ; au clavier : Alt + ↑ / ↓
        var handle = el('span', 'drag-handle', '⋮⋮');
        handle.title = 'Glisser pour déplacer (ou Alt + ↑ / ↓)';
        handle.setAttribute('aria-hidden', 'true');
        handle.addEventListener('pointerdown', function (e) { startRowDrag(e, row, item); });
        row.appendChild(handle);

        if (item.type === 'task' || item.type === 'deadline') {
          var box_ = el('input');
          box_.type = 'checkbox';
          box_.checked = item.done;
          box_.setAttribute('aria-label', 'Cocher la tâche');
          box_.addEventListener('change', function () {
            var it = store.toggleTask(noteId, item.id);
            row.classList.toggle('done', it.done);
            if (it.type === 'deadline') Notes.view.updateDeadline(row, it, Notes.workdays.todayISO());
          });
          row.appendChild(box_);
        }

        var ta = el('div', 'editor-item-text');
        ta.contentEditable = 'true';
        ta.spellcheck = true;
        ta.setAttribute('role', 'textbox');
        ta.setAttribute('aria-multiline', item.type === 'text' ? 'true' : 'false');
        ta.dataset.placeholder = item.type === 'text' ? 'Texte' : 'Tâche';
        R.renderRich(ta, item.text);
        ta.addEventListener('input', function () {
          if (!richPlain(ta)) ta.textContent = '';            // vide → le texte d'aide réapparaît
          store.updateItem(noteId, item.id, { text: richValue(ta) });
          lastPoint = { itemId: item.id, caret: getCaret(ta).start };
          if (item.type === 'text') checkboxShortcut(item, ta);
        });
        ['keyup', 'mouseup'].forEach(function (ev) {
          ta.addEventListener(ev, function () { lastPoint = { itemId: item.id, caret: getCaret(ta).start }; });
        });
        ta.addEventListener('keydown', function (e) { onItemKey(e, item, ta); });
        // Coller : texte simple uniquement (pas de mise en forme venue de Word ou d'un mail)
        ta.addEventListener('paste', function (e) {
          e.preventDefault();
          var txt = (e.clipboardData || global.clipboardData).getData('text/plain') || '';
          if (item.type !== 'text') txt = txt.replace(/\s*\n\s*/g, ' ');
          document.execCommand('insertText', false, txt);
        });
        ta.addEventListener('drop', function (e) { e.preventDefault(); });
        row.appendChild(ta);

        if (item.type === 'deadline') {
          // Délai modifiable sur place ; l'échéance est recalculée depuis la date de début
          var days = el('input', 'editor-dl-days');
          days.type = 'number';
          days.min = 1;
          days.max = Notes.MAX_DAYS;
          days.value = item.days;
          days.setAttribute('aria-label', 'Délai en jours ouvrés');
          days.addEventListener('change', function () {
            try {
              var it = store.updateItem(noteId, item.id, { days: days.value });
              Notes.view.updateDeadline(row, it, Notes.workdays.todayISO());
            } catch (err) {
              days.value = store.getNote(noteId).items[indexOfItem(item.id)].days;
            }
          });
          row.appendChild(days);
          row.appendChild(el('span', 'editor-dl-unit', 'j'));
          row.appendChild(el('span', 'dl-label'));
        }

        var del = el('button', 'editor-item-del', '×');
        del.type = 'button';
        del.title = 'Supprimer cet élément';
        del.setAttribute('aria-label', 'Supprimer cet élément');
        del.addEventListener('click', function () {
          store.deleteItem(noteId, item.id);
          renderItems();
        });
        row.appendChild(del);

        if (item.type === 'deadline') {
          Notes.view.updateDeadline(row, item, today);
        }

        itemsEl.appendChild(row);
        if (focus && focus.itemId === item.id) toFocus = { ta: ta, caret: focus.caret };
      });

      if (toFocus) {
        toFocus.ta.focus();
        setCaret(toFocus.ta, typeof toFocus.caret === 'number' ? toFocus.caret : richPlain(toFocus.ta).length);
      }
    }

    function indexOfItem(itemId) {
      var items = store.getNote(noteId).items;
      for (var i = 0; i < items.length; i++) if (items[i].id === itemId) return i;
      return -1;
    }

    // ---------------------------------------------------------- clavier

    // ---------------------------------------------------------- déplacer une ligne

    /** Glisser une ligne par sa poignée : déplacement en direct dans la liste. */
    function startRowDrag(e, row, item) {
      if (e.button !== 0) return;
      e.preventDefault();
      var startIndex = indexOfItem(item.id);
      // Écoute sur le document : déplacer la ligne dans le DOM ferait perdre une
      // capture de pointeur posée sur la poignée.
      row.classList.add('row-dragging');
      document.body.classList.add('is-dragging');

      function onMove(ev) {
        var rows = Array.prototype.filter.call(itemsEl.children, function (r) { return r !== row; });
        var before = null;
        for (var i = 0; i < rows.length; i++) {
          var r = rows[i].getBoundingClientRect();
          if (ev.clientY < r.top + r.height / 2) { before = rows[i]; break; }
        }
        if (before !== row.nextSibling) itemsEl.insertBefore(row, before);
      }

      function onUp() {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        row.classList.remove('row-dragging');
        document.body.classList.remove('is-dragging');
        var newIndex = Array.prototype.indexOf.call(itemsEl.children, row);
        if (newIndex !== startIndex) store.moveItem(noteId, item.id, newIndex);
        renderItems();
      }

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    }

    /** Alt + ↑ / ↓ : monte / descend la ligne en gardant le curseur. */
    function moveRowByKey(item, ta, delta) {
      var idx = indexOfItem(item.id);
      var to = idx + delta;
      if (to < 0 || to >= store.getNote(noteId).items.length) return;
      var caret = getCaret(ta).start;
      store.moveItem(noteId, item.id, to);
      renderItems({ itemId: item.id, caret: caret });
    }

    function onItemKey(e, item, ta) {
      // Ctrl+B / Ctrl+I : gras / italique ; Ctrl+U désactivé (le souligné n'est pas conservé)
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        var k = e.key.toLowerCase();
        if (k === 'b' || k === 'i') {
          e.preventDefault();
          document.execCommand(k === 'b' ? 'bold' : 'italic');
          store.updateItem(noteId, item.id, { text: richValue(ta) });
          return;
        }
        if (k === 'u') { e.preventDefault(); return; }
      }
      // Texte libre : Entrée = saut de ligne dans la même zone
      if (e.key === 'Enter' && item.type === 'text') {
        e.preventDefault();
        document.execCommand('insertLineBreak');
        return;
      }
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        moveRowByKey(item, ta, e.key === 'ArrowUp' ? -1 : 1);
        return;
      }
      // Tâche à délai : une seule ligne
      if (e.key === 'Enter' && item.type === 'deadline') {
        e.preventDefault();
        return;
      }
      // Entrée sur une case vide → fin de la liste : on repasse en texte
      if (e.key === 'Enter' && !e.shiftKey && item.type === 'task' && richPlain(ta) === '') {
        e.preventDefault();
        var iE = indexOfItem(item.id);
        var nextE = store.getNote(noteId).items[iE + 1];
        store.deleteItem(noteId, item.id);
        if (nextE && nextE.type === 'text') {                  // le texte qui suit reprend : ligne vide en tête
          store.updateItem(noteId, nextE.id, { text: R.concat('\n', nextE.text) });
          renderItems({ itemId: nextE.id, caret: 0 });
        } else {
          var txt = store.addItem(noteId, { type: 'text', text: '' }, iE);
          renderItems({ itemId: txt.id, caret: 0 });
        }
        return;
      }
      // Entrée dans une tâche → nouvelle tâche en dessous, avec la fin du texte
      if (e.key === 'Enter' && !e.shiftKey && item.type === 'task') {
        e.preventDefault();
        var sel = getCaret(ta), value = richValue(ta);
        var before = R.split(value, sel.start)[0];
        var after = R.split(value, sel.end)[1];               // la mise en forme suit le texte
        store.updateItem(noteId, item.id, { text: before });
        var created = store.addItem(noteId, { type: 'task', text: after }, indexOfItem(item.id) + 1);
        renderItems({ itemId: created.id, caret: 0 });
        return;
      }
      // Retour arrière en début d'une ligne non vide → fusion avec la ligne précédente
      // (texte ou case à cocher uniquement ; jamais avec une tâche à délai)
      var caretNow = e.key === 'Backspace' ? getCaret(ta) : null;
      var isEmpty = e.key === 'Backspace' && richPlain(ta) === '';
      if (e.key === 'Backspace' && !isEmpty && caretNow.start === 0 && caretNow.end === 0) {
        if (item.type === 'deadline') return;
        var i0 = indexOfItem(item.id);
        var prevItem = i0 > 0 ? store.getNote(noteId).items[i0 - 1] : null;
        if (!prevItem || prevItem.type === 'deadline') return;
        e.preventDefault();
        // Vers un texte : la ligne s'ajoute comme nouvelle ligne du texte (une case redevient du texte)
        var glue = prevItem.type === 'text' ? '\n' : '';
        var caret = R.plain(prevItem.text).length + glue.length;
        store.updateItem(noteId, prevItem.id, { text: R.concat(R.concat(prevItem.text, glue), richValue(ta)) });
        store.deleteItem(noteId, item.id);
        renderItems({ itemId: prevItem.id, caret: caret });
        return;
      }
      // Retour arrière sur une ligne vide → la supprime, remonte à la précédente
      if (isEmpty) {
        e.preventDefault();
        var idx = indexOfItem(item.id);
        var items = store.getNote(noteId).items;
        var prev = idx > 0 ? items[idx - 1] : null;
        store.deleteItem(noteId, item.id);
        if (prev) renderItems({ itemId: prev.id });
        else { renderItems(); focusEnd(titleInput); }
      }
    }

    titleInput.addEventListener('input', function () {
      store.updateNote(noteId, { title: titleInput.value });
    });

    // Entrée dans le titre → descend au premier élément (ou en crée un)
    titleInput.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      var items = store.getNote(noteId).items;
      if (items.length) renderItems({ itemId: items[0].id });
      else addItem('text');
    });

    function onDocKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    }

    // ---------------------------------------------------------- actions

    /** Ligne (et position du curseur) où l'on se trouve, ou null. */
    function currentPoint() {
      var ae = document.activeElement;
      if (ae && ae.classList && ae.classList.contains('editor-item-text') && itemsEl.contains(ae)) {
        return { itemId: ae.closest('.editor-item').dataset.id, caret: getCaret(ae).start };
      }
      return lastPoint;
    }

    /**
     * Insère un élément à l'endroit du curseur :
     *  - curseur dans un texte (et case / tâche à insérer) → le texte est coupé après la ligne
     *    en cours, l'élément se glisse dessous (sur une ligne vide, il la remplace) ;
     *  - curseur dans une autre ligne → juste en dessous ;
     *  - pas de curseur → en fin de carte.
     */
    function insertItem(fields, point) {
      var items = store.getNote(noteId).items;
      var idx = point ? indexOfItem(point.itemId) : -1;
      if (idx === -1) return store.addItem(noteId, fields);
      var host = items[idx];
      if (host.type === 'text' && fields.type !== 'text') {
        var cut = R.cutAfterLine(host.text, point.caret);
        var at = idx + 1;
        if (cut[0]) store.updateItem(noteId, host.id, { text: cut[0] });
        else { store.deleteItem(noteId, host.id); at = idx; }
        var created = store.addItem(noteId, fields, at);
        if (cut[1]) store.addItem(noteId, { type: 'text', text: cut[1] }, at + 1);
        return created;
      }
      return store.addItem(noteId, fields, idx + 1);
    }

    function addItem(type) {
      var created = insertItem({ type: type, text: '' }, currentPoint());
      lastPoint = null;
      renderItems({ itemId: created.id });
    }

    /** « [] » ou « [ ] » + espace en début de ligne d'un texte → la ligne devient une case. */
    function checkboxShortcut(item, ta) {
      var c = getCaret(ta);
      if (c.start !== c.end) return;
      var value = richValue(ta);
      var L = R.lineAt(value, c.start);
      if (!/^\[ ?\][ \u00a0]$/.test(L.text.slice(0, c.start - L.start))) return;
      var before = L.start > 0 ? R.slice(value, 0, L.start - 1) : '';
      var rest = R.slice(value, c.start, L.end);
      var after = L.end < L.length ? R.slice(value, L.end + 1) : '';
      var idx = indexOfItem(item.id), at = idx + 1;
      if (before) store.updateItem(noteId, item.id, { text: before });
      else { store.deleteItem(noteId, item.id); at = idx; }
      var created = store.addItem(noteId, { type: 'task', text: rest }, at);
      if (after) store.addItem(noteId, { type: 'text', text: after }, at + 1);
      renderItems({ itemId: created.id, caret: 0 });
    }

    // Cliquer un bouton d'ajout ne doit pas faire perdre la position du curseur
    addBar.addEventListener('mousedown', function (e) { if (e.target.closest('button')) e.preventDefault(); });
    titleInput.addEventListener('focus', function () { lastPoint = null; });
    tagInput.addEventListener('focus', function () { lastPoint = null; });

    btnAddText.addEventListener('click', function () { addItem('text'); });
    btnAddTask.addEventListener('click', function () { addItem('task'); });

    // ---------------------------------------------------------- étiquettes

    function renderTags() {
      var tags = store.getNote(noteId).tags;
      tagsList.textContent = '';
      tags.forEach(function (t) {
        var chip = el('span', 'tag tag-editable', t);
        var x = el('button', 'tag-remove', '×');
        x.type = 'button';
        x.title = 'Retirer l\'étiquette « ' + t + ' »';
        x.setAttribute('aria-label', 'Retirer l\'étiquette ' + t);
        x.addEventListener('click', function () {
          store.updateNote(noteId, { tags: store.getNote(noteId).tags.filter(function (y) { return y !== t; }) });
          renderTags();
          tagInput.focus();
        });
        chip.appendChild(x);
        tagsList.appendChild(chip);
      });
      // Suggestions : étiquettes existantes pas encore sur cette note
      var have = tags.map(function (t) { return t.toLowerCase(); });
      tagSuggest.textContent = '';
      store.getAllTags().forEach(function (t) {
        if (have.indexOf(t.tag.toLowerCase()) !== -1) return;
        var o = document.createElement('option');
        o.value = t.tag;
        tagSuggest.appendChild(o);
      });
    }

    /** Ajoute le contenu du champ ; réutilise la graphie d'une étiquette existante. */
    function commitTag() {
      var v = tagInput.value.replace(/,/g, ' ').trim();
      tagInput.value = '';
      if (!v) return;
      var existing = store.getAllTags().filter(function (t) { return t.tag.toLowerCase() === v.toLowerCase(); })[0];
      if (existing) v = existing.tag;
      store.updateNote(noteId, { tags: store.getNote(noteId).tags.concat([v]) }); // doublons filtrés par le store
      renderTags();
    }

    tagInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commitTag(); return; }
      if (e.key === 'Backspace' && tagInput.value === '') {
        var tags = store.getNote(noteId).tags;
        if (tags.length) { store.updateNote(noteId, { tags: tags.slice(0, -1) }); renderTags(); }
      }
    });
    tagInput.addEventListener('blur', function () { if (noteId && tagInput.value.trim()) commitTag(); });
    // Choix dans la liste de suggestions → ajout direct
    tagInput.addEventListener('input', function (e) {
      if (e.inputType === 'insertReplacementText' || e.inputType === undefined) {
        var v = tagInput.value.trim().toLowerCase();
        if (store.getAllTags().some(function (t) { return t.tag.toLowerCase() === v; })) commitTag();
      }
    });

    // ---------------------------------------------------------- couleur

    function syncPalette(color) {
      Array.prototype.forEach.call(palette.children, function (sw) {
        var on = sw.dataset.color === color;
        sw.classList.toggle('selected', on);
        sw.setAttribute('aria-checked', on ? 'true' : 'false');
      });
      box.className = 'editor color-' + color;
    }

    palette.addEventListener('click', function (e) {
      var sw = e.target.closest('.swatch');
      if (!sw) return;
      store.updateNote(noteId, { color: sw.dataset.color });
      syncPalette(sw.dataset.color);
    });

    // ---------------------------------------------------------- mode tâche

    function updatePreview() {
      var n = Number(dlDays.value);
      if (Number.isInteger(n) && n >= 1 && n <= Notes.MAX_DAYS) {
        var today = Notes.workdays.todayISO();
        var due = Notes.workdays.addWorkingDays(today, n);
        var hol = Notes.workdays.holidaysBetween(today, due);
        dlPreview.textContent = '→ ' + Notes.workdays.formatShort(due)
          + (hol.length ? '  (' + hol.map(function (h) { return h.name; }).join(', ') + ' exclu'
            + (hol.length > 1 ? 's' : '') + ')' : '');
      } else {
        dlPreview.textContent = '';
      }
    }

    function openDeadlineForm() {
      pendingPoint = currentPoint();
      dlText.value = '';
      dlDays.value = 5;
      dlError.textContent = '';
      dlForm.hidden = false;
      btnAddDeadline.hidden = true;
      updatePreview();
      dlText.focus();
    }

    function closeDeadlineForm() {
      dlForm.hidden = true;
      btnAddDeadline.hidden = false;
    }

    function submitDeadline() {
      var text = dlText.value.trim();
      if (!text) {
        dlError.textContent = 'Saisis l\'intitulé de la tâche.';
        dlText.focus();
        return;
      }
      try {
        insertItem({ type: 'deadline', text: text, days: dlDays.value }, pendingPoint);
        pendingPoint = null;
        lastPoint = null;
      } catch (err) {
        dlError.textContent = err.message;
        dlDays.focus();
        return;
      }
      closeDeadlineForm();
      renderItems();
      btnAddDeadline.focus();
    }

    function onFormKey(e) {
      if (e.key === 'Enter') { e.preventDefault(); submitDeadline(); }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation(); // Échap ferme le formulaire, pas la carte
        closeDeadlineForm();
        btnAddDeadline.focus();
      }
    }

    btnAddDeadline.addEventListener('click', openDeadlineForm);
    dlOk.addEventListener('click', submitDeadline);
    dlCancel.addEventListener('click', function () { closeDeadlineForm(); btnAddDeadline.focus(); });
    dlText.addEventListener('keydown', onFormKey);
    dlDays.addEventListener('keydown', onFormKey);
    dlDays.addEventListener('input', updatePreview);
    btnClose.addEventListener('click', function () { close(); });

    // Clic dans la zone sombre (hors de la carte) → fermeture
    overlay.addEventListener('mousedown', function (e) {
      if (e.target === overlay) close();
    });

    // Suppression en un clic : annulable via le bandeau (onDeleted reçoit l'instantané)
    btnDelete.addEventListener('click', function () {
      var id = noteId;
      close({ skipFinalize: true });
      onDeleted(store.deleteNote(id));
    });

    // Archiver / désarchiver : la carte se ferme, annulable via le bandeau
    btnArchive.addEventListener('click', function () {
      var id = noteId;
      var archived = !store.getNote(id).archived;
      if (close().deleted) return;          // note vide : supprimée à la fermeture
      store.setArchived(id, archived);
      onArchived(id, archived);
    });

    // ---------------------------------------------------------- ouverture / fermeture

    /**
     * @param {string} id
     * @param {Object} [options]  { focusItemId } : place le curseur sur cet élément
     */
    function open(id, options) {
      if (noteId) close();
      noteId = id;
      lastPoint = null;
      pendingPoint = null;
      lastFocus = document.activeElement;
      var note = store.getNote(id);
      titleInput.value = note.title;
      btnArchive.textContent = note.archived ? 'Désarchiver' : 'Archiver';
      closeDeadlineForm();
      syncPalette(note.color);
      tagInput.value = '';
      renderTags();
      overlay.hidden = false;
      document.body.classList.add('modal-open');
      document.addEventListener('keydown', onDocKey);
      renderItems();
      var focusId = options && options.focusItemId;
      if (focusId && note.items.some(function (i) { return i.id === focusId; })) {
        renderItems({ itemId: focusId });
        var row = itemsEl.querySelector('[data-id="' + focusId + '"]');
        if (row) {
          row.scrollIntoView({ block: 'nearest' });
          row.classList.add('flash');                       // repère visuel bref
          setTimeout(function () { row.classList.remove('flash'); }, 1200);
        }
      } else if (!note.title && note.items.length) {
        // Note sans titre et avec contenu → curseur en fin de dernier élément
        renderItems({ itemId: note.items[note.items.length - 1].id });
      } else {
        focusEnd(titleInput);
      }
    }

    /** @returns {{deleted:boolean}} deleted : note vide supprimée à la fermeture */
    function close(options) {
      if (!noteId) return { deleted: false };
      var skip = options && options.skipFinalize;
      if (tagInput.value.trim() && !skip) commitTag(); // étiquette en cours de saisie
      var id = noteId;
      noteId = null;
      overlay.hidden = true;
      document.body.classList.remove('modal-open');
      document.removeEventListener('keydown', onDocKey);
      itemsEl.textContent = '';
      var res = skip ? { deleted: false } : store.finalizeNote(id);
      if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
      return res;
    }

    return {
      open: open,
      close: close,
      isOpen: function () { return noteId !== null; },
      currentId: function () { return noteId; }
    };
  }

  Notes.createEditor = createEditor;
})(window);
