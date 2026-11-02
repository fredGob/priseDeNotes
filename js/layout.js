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
  Notes.slotAt = slotAt;
})(window);
