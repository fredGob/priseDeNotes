/*
 * panel.js — Panneau de droite : toutes les tâches à délai de toutes les cartes.
 *
 * - Tri par urgence (la plus proche de l'échéance, ou en retard, en haut).
 * - On coche directement depuis la liste.
 * - Section repliable « Terminées » en bas (état ouvert/fermé conservé).
 * - Clic sur une tâche (ou Entrée) → ouvre sa carte, curseur sur la tâche.
 *
 * Expose : window.Notes.createPanel({ store, root, onOpen })
 */
(function (global) {
  'use strict';

  var Notes = global.Notes || (global.Notes = {});

  function createPanel(opts) {
    var store = opts.store;
    var root = opts.root;
    var V = Notes.view;
    var el = V.el;
    var doneOpen = false;
    var onOpen = opts.onOpen || function () {};

    function renderTask(entry, today) {
      var item = entry.item;
      var li = el('li', 'panel-task');
      li.dataset.noteId = entry.noteId;
      li.dataset.itemId = item.id;
      li.tabIndex = 0;

      var row = el('div', 'dl-row');
      var box = el('input');
      box.type = 'checkbox';
      box.checked = item.done;
      box.setAttribute('aria-label', (item.done ? 'Rouvrir « ' : 'Terminer « ') + Notes.rich.plain(item.text) + ' »');
      row.appendChild(box);

      var main = el('div', 'panel-task-main');
      main.appendChild(V.richEl('span', 'panel-task-text', item.text));
      var meta = el('span', 'panel-task-meta');
      meta.appendChild(el('span', 'color-dot color-' + entry.noteColor));
      meta.appendChild(document.createTextNode(entry.noteTitle || 'Sans titre'));
      main.appendChild(meta);
      row.appendChild(main);

      row.appendChild(el('span', 'dl-label'));
      li.appendChild(row);
      V.updateDeadline(li, item, today);
      return li;
    }

    function render() {
      var data = store.getDeadlineTasks();
      var today = Notes.workdays.todayISO();
      root.textContent = '';

      var head = el('h2', 'panel-title', 'Tâches');
      head.appendChild(el('span', 'panel-count', String(data.active.length)));
      root.appendChild(head);

      if (!data.active.length) {
        root.appendChild(el('p', 'panel-empty',
          'Aucune tâche en cours. Ouvre une carte et clique sur « + Tâche à délai ».'));
      } else {
        var ul = el('ul', 'panel-list');
        data.active.forEach(function (e) { ul.appendChild(renderTask(e, today)); });
        root.appendChild(ul);
      }

      if (data.done.length) {
        var det = el('details', 'panel-done');
        det.open = doneOpen;
        det.appendChild(el('summary', null, 'Terminées (' + data.done.length + ')'));
        var ulDone = el('ul', 'panel-list');
        data.done.forEach(function (e) { ulDone.appendChild(renderTask(e, today)); });
        det.appendChild(ulDone);
        det.addEventListener('toggle', function () { doneOpen = det.open; });
        root.appendChild(det);
      }
    }

    // Délégation : cocher / décocher depuis la liste
    root.addEventListener('change', function (e) {
      if (e.target.type !== 'checkbox') return;
      var li = e.target.closest('.panel-task');
      store.toggleTask(li.dataset.noteId, li.dataset.itemId);
    });

    // Clic sur une tâche (hors case à cocher) → ouvre sa carte
    root.addEventListener('click', function (e) {
      if (e.target.type === 'checkbox') return;
      var li = e.target.closest('.panel-task');
      if (li) onOpen(li.dataset.noteId, li.dataset.itemId);
    });
    root.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.classList.contains('panel-task')) {
        onOpen(e.target.dataset.noteId, e.target.dataset.itemId);
      }
    });

    return { render: render };
  }

  Notes.createPanel = createPanel;
})(window);
