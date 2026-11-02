/*
 * drag.js — Glisser-déposer des cartes dans la grille (souris).
 *
 * Pas de drag & drop HTML5 natif (peu adapté à une grille en position absolue) :
 * on suit le pointeur nous-mêmes.
 *  - appui sur une carte puis déplacement > 5 px → la carte suit la souris ;
 *  - en survolant l'emplacement d'une autre carte, elle prend sa place et la grille
 *    se réorganise en direct (aperçu) ;
 *  - au relâchement, le nouvel ordre est enregistré (store.moveNote).
 * Un simple clic (sans déplacement) ouvre toujours la carte.
 * Fonctionne aussi avec un filtre actif (Notes.dropIndex).
 *
 * Expose : window.Notes.enableGridDrag({ store, ui })
 */
(function (global) {
  'use strict';

  var Notes = global.Notes || (global.Notes = {});
  var THRESHOLD = 5;      // px avant de considérer qu'on glisse
  var EDGE = 60;          // px du bord de fenêtre déclenchant le défilement
  var SCROLL_STEP = 14;

  function enableGridDrag(opts) {
    var store = opts.store;
    var ui = opts.ui;
    var grid = ui.grid;

    var press = null;     // { card, id, x0, y0 } entre l'appui et le début du glissement
    var drag = null;      // { card, id, offX, offY, order, lastSwap }
    var lastPointer = null;
    var scrollTimer = null;

    grid.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      var card = e.target.closest('.card');
      if (!card || e.target.closest('input, button, a')) return; // cases à cocher, étiquettes
      press = { card: card, id: card.dataset.id, x0: e.clientX, y0: e.clientY };
    });

    document.addEventListener('pointermove', function (e) {
      if (!press && !drag) return;
      lastPointer = { x: e.clientX, y: e.clientY };
      if (press && !drag) {
        if (Math.abs(e.clientX - press.x0) < THRESHOLD && Math.abs(e.clientY - press.y0) < THRESHOLD) return;
        start(press);
        press = null;
      }
      if (drag) { e.preventDefault(); update(); }
    });

    document.addEventListener('pointerup', function () {
      press = null;
      if (drag) finish();
    });

    // Fenêtre qui perd le focus en plein glissement → on termine proprement
    global.addEventListener('blur', function () { press = null; if (drag) finish(); });

    function start(p) {
      var slot = ui.getSlots().filter(function (s) { return s.id === p.id; })[0];
      if (!slot) return;
      var rect = grid.getBoundingClientRect();
      drag = {
        card: p.card,
        id: p.id,
        offX: p.x0 - rect.left - slot.x,   // où la carte a été saisie
        offY: p.y0 - rect.top - slot.y,
        order: ui.visibleIds(),
        lastSwap: null
      };
      p.card.classList.add('dragging');
      document.body.classList.add('is-dragging');
      var sel = global.getSelection && global.getSelection();
      if (sel) sel.removeAllRanges();
      scrollTimer = setInterval(autoScroll, 16);
    }

    function update() {
      var rect = grid.getBoundingClientRect();
      var x = lastPointer.x - rect.left;
      var y = lastPointer.y - rect.top;
      drag.card.style.transform = 'translate(' + (x - drag.offX) + 'px,' + (y - drag.offY) + 'px)';

      // Emplacement survolé (hors carte tenue)
      var slots = ui.getSlots();
      var others = slots.filter(function (s) { return s.id !== drag.id; });
      var hit = Notes.slotAt(others, x, y, ui.cardWidth());
      var target = hit === -1 ? null : others[hit].id;

      // Anti-oscillation : après un échange, la grille bouge sous la souris ; on ignore la
      // carte échangée tant que le pointeur ne l'a pas quittée.
      if (target !== drag.lastSwap) drag.lastSwap = null;
      if (target && drag.lastSwap === null) {
        var from = drag.order.indexOf(drag.id);
        var at = drag.order.indexOf(target);
        var order = drag.order.filter(function (id) { return id !== drag.id; });
        // Vers l'arrière de la liste : après la cible ; vers l'avant : à sa place
        order.splice(order.indexOf(target) + (from < at ? 1 : 0), 0, drag.id);
        drag.order = order;
        drag.lastSwap = target;
        ui.layout(drag.order, drag.id);
      }
    }

    function autoScroll() {
      if (!drag || !lastPointer) return;
      var dy = 0;
      if (lastPointer.y < EDGE) dy = -SCROLL_STEP;
      else if (lastPointer.y > global.innerHeight - EDGE) dy = SCROLL_STEP;
      if (dy) { global.scrollBy(0, dy); update(); }
    }

    function finish() {
      clearInterval(scrollTimer);
      var d = drag;
      drag = null;
      d.card.classList.remove('dragging');
      document.body.classList.remove('is-dragging');
      ui.suppressNextClick(); // le relâchement ne doit pas ouvrir la carte

      var before = ui.visibleIds();
      var changed = before.join() !== d.order.join();
      if (changed) {
        var all = store.getNotes().map(function (n) { return n.id; });
        store.moveNote(d.id, Notes.dropIndex(all, d.order, d.id)); // → re-rendu via onChange
      } else {
        ui.layout(); // retour à sa place
      }
    }

    return { isDragging: function () { return drag !== null; } };
  }

  Notes.enableGridDrag = enableGridDrag;
})(window);
