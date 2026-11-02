/*
 * layout.js — Calcul du placement « maçonnerie » des cartes (style Keep).
 *
 * Logique pure, sans DOM : on lui donne les hauteurs des cartes dans l'ordre,
 * il renvoie la position (x, y) de chacune. Chaque carte va dans la colonne
 * la moins haute (à égalité : la plus à gauche) → l'ordre se lit de gauche
 * à droite puis de haut en bas, comme dans Keep.
 *
 * Expose : window.Notes.masonry(heights, options)
 */
(function (global) {
  'use strict';

  var Notes = global.Notes || (global.Notes = {});

  /**
   * @param {number[]} heights        hauteur de chaque carte, dans l'ordre d'affichage
   * @param {Object}   options
   * @param {number}   options.containerWidth  largeur disponible (px)
   * @param {number}   options.cardWidth       largeur fixe d'une carte (px)
   * @param {number}   options.gap             espace entre cartes (px)
   * @returns {{columns:number, positions:{x:number,y:number}[], width:number, height:number}}
   */
  function masonry(heights, options) {
    var cw = options.cardWidth;
    var gap = options.gap;
    var columns = Math.max(1, Math.floor((options.containerWidth + gap) / (cw + gap)));
    var gridWidth = columns * cw + (columns - 1) * gap;
    var offsetX = Math.max(0, (options.containerWidth - gridWidth) / 2); // grille centrée

    var colHeights = [];
    for (var c = 0; c < columns; c++) colHeights.push(0);

    var positions = heights.map(function (h) {
      var col = 0;
      for (var i = 1; i < columns; i++) {
        if (colHeights[i] < colHeights[col]) col = i;
      }
      var pos = { x: offsetX + col * (cw + gap), y: colHeights[col] };
      colHeights[col] += h + gap;
      return pos;
    });

    var maxH = Math.max.apply(null, colHeights);
    return {
      columns: columns,
      positions: positions,
      width: gridWidth,
      height: heights.length ? maxH - gap : 0
    };
  }

  /**
   * Placement par colonnes mémorisées : chaque carte reste dans SA colonne (`col`),
   * empilée dans l'ordre de la liste. Une carte sans colonne valide (pas encore placée,
   * ou colonne qui n'existe plus parce que la fenêtre a rétréci) va dans la plus courte.
   * @param {{col:(number|undefined), h:number}[]} cards  dans l'ordre global
   * @returns {{columns, positions, cols, width, height, offsetX}}  cols : colonne retenue
   */
  function columnLayout(cards, options) {
    var cw = options.cardWidth;
    var gap = options.gap;
    var columns = Math.max(1, Math.floor((options.containerWidth + gap) / (cw + gap)));
    var gridWidth = columns * cw + (columns - 1) * gap;
    var offsetX = Math.max(0, (options.containerWidth - gridWidth) / 2);
    var colHeights = [];
    for (var c = 0; c < columns; c++) colHeights.push(0);

    var cols = [];
    var positions = cards.map(function (card) {
      var col = card.col;
      if (!(Number.isInteger(col) && col >= 0 && col < columns)) {
        col = 0;
        for (var i = 1; i < columns; i++) if (colHeights[i] < colHeights[col]) col = i;
      }
      cols.push(col);
      var pos = { x: offsetX + col * (cw + gap), y: colHeights[col] };
      colHeights[col] += card.h + gap;
      return pos;
    });
    var maxH = Math.max.apply(null, colHeights);
    return {
      columns: columns, positions: positions, cols: cols, width: gridWidth, offsetX: offsetX,
      height: cards.length ? maxH - gap : 0
    };
  }

  /** Colonne sous l'abscisse x (bornée aux colonnes existantes). */
  function columnAt(x, geo) {
    var c = Math.floor((x - geo.offsetX + geo.gap / 2) / (geo.cardWidth + geo.gap));
    return Math.max(0, Math.min(geo.columns - 1, c));
  }

  /**
   * Position d'insertion dans une colonne : nombre de cartes dont le milieu est
   * au-dessus du pointeur. @param {{y:number,h:number}[]} colSlots  de haut en bas
   */
  function insertIndex(colSlots, y) {
    var n = 0;
    colSlots.forEach(function (s) { if (s.y + s.h / 2 < y) n += 1; });
    return n;
  }

  /**
   * Index de l'emplacement sous le point (x, y), ou -1.
   * @param {{x:number,y:number,h:number}[]} slots
   * @param {number} cardWidth
   */
  function slotAt(slots, x, y, cardWidth) {
    for (var i = 0; i < slots.length; i++) {
      var s = slots[i];
      if (x >= s.x && x < s.x + cardWidth && y >= s.y && y < s.y + s.h) return i;
    }
    return -1;
  }

  Notes.masonry = masonry;
  Notes.columnLayout = columnLayout;
  Notes.columnAt = columnAt;
  Notes.insertIndex = insertIndex;
  Notes.slotAt = slotAt;
})(window);
