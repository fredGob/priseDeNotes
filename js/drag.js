/*
 * drag.js — Glisser-déposer des cartes dans la grille (souris).
 *
 * Pas de drag & drop HTML5 natif (peu adapté à une grille en position absolue) :
 * on suit le pointeur nous-mêmes.
 *  - appui sur une carte puis déplacement > 5 px → la carte suit la souris ;
 *  - chaque carte appartient à une colonne : la carte tenue va dans la colonne sous
 *    elle, à la hauteur du pointeur ; seules les colonnes de départ et d'arrivée
 *    se réorganisent (aperçu en direct), les autres ne bougent pas ;
 *  - au relâchement : store.placeNote(id, colonne, carte du dessous, carte du dessus).
 * Un simple clic (sans déplacement) ouvre toujours la carte.
 * Fonctionne aussi avec un filtre actif (insertion relative aux cartes visibles).
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
    var drag = null;      // { card, id, offX, offY, cols, from, target }
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

    /** Colonnes actuelles (hors carte tenue) : [[id, …] de haut en bas] */
    function columnsWithout(id, slots, n) {
      var cols = [];
      for (var c = 0; c < n; c++) cols.push([]);
      slots.filter(function (s) { return s.id !== id; })
        .sort(function (a, b) { return a.y - b.y; })
        .forEach(function (s) { cols[s.col].push(s.id); });
      return cols;
    }

    function start(p) {
      var slots = ui.getSlots();
      var slot = slots.filter(function (s) { return s.id === p.id; })[0];
      var g = ui.getGeometry();
      if (!slot || !g) return;
      var rect = grid.getBoundingClientRect();
      var cols = columnsWithout(p.id, slots, g.columns);
      // Positions de référence (colonnes sans la carte tenue), FIXES pendant le geste :
      // le point de dépôt ne « fuit » pas quand l'aperçu fait descendre les cartes.
      var hOf = {};
      slots.forEach(function (s) { hOf[s.id] = s.h; });
      var base = cols.map(function (list) {
        var y = 0;
        return list.map(function (id) { var r = { y: y, h: hOf[id] }; y += hOf[id] + g.gap; return r; });
      });
      var srcIdx = slots.filter(function (s) { return s.col === slot.col && s.id !== p.id && s.y < slot.y; }).length;
      drag = {
        card: p.card,
        id: p.id,
        offX: p.x0 - rect.left - slot.x,   // où la carte a été saisie
        offY: p.y0 - rect.top - slot.y,
        cols: cols,                         // colonnes sans la carte tenue (fixes pendant le geste)
        base: base,
        from: { col: slot.col, idx: srcIdx },
        target: { col: slot.col, idx: srcIdx }
      };
      p.card.classList.add('dragging');
      document.body.classList.add('is-dragging');
      var sel = global.getSelection && global.getSelection();
      if (sel) sel.removeAllRanges();
      scrollTimer = setInterval(autoScroll, 16);
    }

    /** Aperçu : la carte tenue réserve sa place dans (col, idx) ; seules les colonnes
        de départ et d'arrivée se réorganisent. */
    function preview() {
      var order = [], cols = {};
      drag.cols.forEach(function (list, c) {
        var l = list.slice();
        if (c === drag.target.col) l.splice(drag.target.idx, 0, drag.id);
        l.forEach(function (id) { order.push(id); cols[id] = c; });
      });
      ui.layout(order, drag.id, cols);
    }

    function update() {
      var rect = grid.getBoundingClientRect();
      var x = lastPointer.x - rect.left;
      var y = lastPointer.y - rect.top;
      drag.card.style.transform = 'translate(' + (x - drag.offX) + 'px,' + (y - drag.offY) + 'px)';

      // Colonne sous le centre de la carte tenue, position selon le pointeur
      var g = ui.getGeometry();
      var col = Notes.columnAt(x - drag.offX + g.cardWidth / 2, g);
      var idx = Notes.insertIndex(drag.base[col], y);
      if (col !== drag.target.col || idx !== drag.target.idx) {
        drag.target = { col: col, idx: idx };
        preview();
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

      var t = d.target;
      if (t.col === d.from.col && t.idx === d.from.idx) { ui.layout(); return; }  // reposée à sa place
      var list = d.cols[t.col];
      store.placeNote(d.id, t.col, list[t.idx] || null, list[t.idx - 1] || null); // → re-rendu via onChange
    }

    return { isDragging: function () { return drag !== null; } };
  }

  Notes.enableGridDrag = enableGridDrag;
})(window);
