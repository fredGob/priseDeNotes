/*
 * ui.js — Rendu de la grille et des cartes.
 *
 * Règles :
 *  - ne modifie jamais les données directement : passe par le store ;
 *  - n'insère jamais de texte utilisateur via innerHTML (textContent uniquement).
 *
 * Expose : window.Notes.createUI({ store, grid, emptyState, filters, onOpenNote })
 */
(function (global) {
  'use strict';

  var Notes = global.Notes || (global.Notes = {});

  var GAP = 16;

  /** Largeur des cartes, lue dans le CSS (--card-w) : suit le réglage de taille. */
  function cardWidth() {
    return parseFloat(getComputedStyle(document.body).getPropertyValue('--card-w')) || 240;
  }

  function el(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // ---------------------------------------------------------------- tâches à délai
  // Briques d'affichage partagées par la grille, l'éditeur et le panneau (Notes.view).

  var LEVELS = ['calm', 'soon', 'urgent', 'late', 'done'];

  function deadlineTitle(item) {
    return 'Échéance : ' + Notes.workdays.formatLong(item.due)
      + ' (' + item.days + ' j ouvrés depuis le ' + Notes.workdays.formatShort(item.start) + ')';
  }

  /**
   * Met à jour classe de niveau, libellé et info-bulle d'un conteneur contenant
   * .dl-label. Utilisé au rendu et lors d'une modification du délai.
   */
  function updateDeadline(container, item, today) {
    var u = Notes.workdays.urgency(item, today);
    LEVELS.forEach(function (l) { container.classList.remove('lvl-' + l); });
    container.classList.add('lvl-' + u.level);
    container.title = deadlineTitle(item);
    var label = container.querySelector('.dl-label');
    if (label) label.textContent = u.label;
    return u;
  }

  /** Élément affichant un texte avec sa mise en forme (gras / italique). */
  function richEl(tag, className, text) {
    var e = el(tag, className);
    Notes.rich.renderRich(e, text);
    return e;
  }

  Notes.view = {
    el: el,
    richEl: richEl,
    updateDeadline: updateDeadline
  };

  // ---------------------------------------------------------------- cartes

  function renderDeadline(item, today) {
    var wrap = el('div', 'item item-deadline');
    var row = el('div', 'dl-row');
    var box = el('input');
    box.type = 'checkbox';
    box.checked = item.done;
    box.dataset.itemId = item.id;
    box.setAttribute('aria-label', 'Terminer « ' + Notes.rich.plain(item.text) + ' »');
    row.appendChild(box);
    row.appendChild(richEl('span', 'item-text', item.text));
    row.appendChild(el('span', 'dl-label'));
    wrap.appendChild(row);
    updateDeadline(wrap, item, today);
    return wrap;
  }

  function renderItem(item, today) {
    if (item.type === 'deadline') return renderDeadline(item, today);
    if (item.type === 'bullet') {
      var li = el('div', 'item item-bullet');
      var dot = el('span', 'bullet-dot', '•');
      dot.setAttribute('aria-hidden', 'true');
      li.appendChild(dot);
      li.appendChild(richEl('span', 'item-text', item.text));
      return li;
    }
    if (item.type === 'task') {
      var row = el('div', 'item item-task' + (item.done ? ' done' : ''));
      var box = el('input');
      box.type = 'checkbox';
      box.checked = item.done;
      box.dataset.itemId = item.id;
      box.setAttribute('aria-label', 'Cocher « ' + Notes.rich.plain(item.text) + ' »');
      row.appendChild(box);
      row.appendChild(richEl('span', 'item-text', item.text));
      return row;
    }
    return richEl('div', 'item item-text-block', item.text);
  }

  function renderCard(note, today) {
    var card = el('article', 'card color-' + note.color);
    card.dataset.id = note.id;
    card.tabIndex = 0; // ouvrable au clavier (Entrée)

    if (note.title) card.appendChild(el('h2', 'card-title', note.title));

    if (note.items.length) {
      var body = el('div', 'card-body');
      note.items.forEach(function (item) { body.appendChild(renderItem(item, today)); });
      card.appendChild(body);
    }

    if (!note.title && !note.items.length) {
      card.appendChild(el('p', 'card-placeholder', 'Note vide'));
    }

    if (note.tags.length) {
      var tags = el('div', 'card-tags');
      note.tags.forEach(function (t) {
        var chip = el('button', 'tag', t);
        chip.type = 'button';
        chip.dataset.tag = t;
        chip.title = 'Filtrer sur « ' + t + ' »';
        tags.appendChild(chip);
      });
      card.appendChild(tags);
    }
    return card;
  }

  // ---------------------------------------------------------------- grille

  function createUI(opts) {
    var store = opts.store;
    var grid = opts.grid;
    var emptyState = opts.emptyState;
    var filtersEl = opts.filters;
    var onOpenNote = opts.onOpenNote || function () {};
    var firstLayout = true;
    var pending = false;
    var renderPending = false;
    var filter = { tag: null, query: '', archived: false };
    var slots = [];            // dernier placement : [{ id, x, y, h, col }]
    var colOf = {};            // colonne mémorisée de chaque carte affichée
    var geo = null;            // géométrie du dernier placement (colonnes, décalage…)
    var suppressClick = false; // posé par drag.js juste après un glisser-déposer

    // Délégation d'événements : un seul écouteur pour toute la grille.
    grid.addEventListener('click', function (e) {
      if (suppressClick) { suppressClick = false; return; }
      var card = e.target.closest('.card');
      if (!card) return;
      var chip = e.target.closest('.tag');
      if (chip) { setFilter({ tag: chip.dataset.tag }); return; }  // clic étiquette → filtre
      var box = e.target.closest('input[type=checkbox]');
      if (box) {
        // Cocher depuis la grille, sans ouvrir la carte
        store.toggleTask(card.dataset.id, box.dataset.itemId);
        return;
      }
      onOpenNote(card.dataset.id);
    });

    grid.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.classList.contains('card')) onOpenNote(e.target.dataset.id);
    });

    function cardsById() {
      var map = {};
      Array.prototype.forEach.call(grid.children, function (c) { map[c.dataset.id] = c; });
      return map;
    }

    /** Ordre actuel des cartes affichées (ids). */
    function visibleIds() {
      return Array.prototype.map.call(grid.children, function (c) { return c.dataset.id; });
    }

    /**
     * Positionne les cartes, chacune dans sa colonne mémorisée.
     * @param {string[]} [order]       ordre à appliquer (aperçu pendant un glisser-déposer)
     * @param {string}   [draggingId]  carte tenue à la souris : sa place est réservée mais
     *                                 elle n'est pas déplacée (elle suit le pointeur)
     * @param {Object}   [cols]        colonnes à utiliser { id: col } (aperçu)
     */
    function layout(order, draggingId, cols) {
      var map = cardsById();
      var ids = order || visibleIds();
      var heights = ids.map(function (id) { return map[id].offsetHeight; });
      var cw = cardWidth();
      var res = Notes.columnLayout(ids.map(function (id, i) {
        return { col: cols ? cols[id] : colOf[id], h: heights[i] };
      }), { containerWidth: grid.clientWidth, cardWidth: cw, gap: GAP });
      geo = { columns: res.columns, offsetX: res.offsetX, cardWidth: cw, gap: GAP };
      slots = ids.map(function (id, i) {
        var p = res.positions[i];
        if (id !== draggingId) map[id].style.transform = 'translate(' + p.x + 'px,' + p.y + 'px)';
        return { id: id, x: p.x, y: p.y, h: heights[i], col: res.cols[i] };
      });
      grid.style.height = res.height + 'px';

      // Pas d'animation au tout premier placement (sinon tout « glisse » depuis le coin).
      if (firstLayout && ids.length) {
        firstLayout = false;
        requestAnimationFrame(function () { grid.classList.add('animated'); });
      }
    }

    /** Relayout groupé sur la prochaine frame (redimensionnement fenêtre…). */
    function scheduleLayout() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; layout(); });
    }

    // ---------------------------------------------------------- filtre

    function setFilter(patch) {
      Object.keys(patch).forEach(function (k) { filter[k] = patch[k]; });
      render();
    }

    /** Vue « Archives » ou vue normale ; le filtre d'étiquette est remis à zéro. */
    function showArchives(on) {
      setFilter({ archived: !!on, tag: null });
    }

    function renderFilters(tags, archivedCount) {
      filtersEl.textContent = '';
      var inArchives = filter.archived;
      filtersEl.hidden = !inArchives && tags.length === 0 && archivedCount === 0;
      if (filtersEl.hidden) return;

      if (inArchives) {
        var back = el('button', 'filter-chip filter-back', '← Notes');
        back.type = 'button';
        back.addEventListener('click', function () { showArchives(false); });
        filtersEl.appendChild(back);
        filtersEl.appendChild(el('span', 'view-title', 'Archives'));
      }

      function chip(label, tag, count) {
        var b = el('button', 'filter-chip' + (filter.tag === tag ? ' active' : ''), label);
        b.type = 'button';
        b.setAttribute('aria-pressed', filter.tag === tag ? 'true' : 'false');
        if (count !== undefined) b.appendChild(el('span', 'filter-count', String(count)));
        b.addEventListener('click', function () {
          setFilter({ tag: tag === null || filter.tag === tag ? null : tag });
        });
        filtersEl.appendChild(b);
      }
      if (tags.length) {
        chip('Toutes', null);
        tags.forEach(function (t) { chip(t.tag, t.tag, t.count); });
      }

      if (!inArchives && archivedCount > 0) {
        var arch = el('button', 'filter-chip filter-archives', 'Archives');
        arch.type = 'button';
        arch.appendChild(el('span', 'filter-count', String(archivedCount)));
        arch.addEventListener('click', function () { showArchives(true); });
        filtersEl.appendChild(arch);
      }
    }

    // ---------------------------------------------------------- rendu

    function render() {
      var notes = store.getNotes();
      var archivedCount = notes.filter(function (n) { return n.archived; }).length;
      if (filter.archived && archivedCount === 0) filter.archived = false; // plus rien en archive
      var tags = store.getAllTags(filter.archived);
      var today = Notes.workdays.todayISO();

      // Étiquette filtrée disparue (renommée, supprimée…) → on retire le filtre
      if (filter.tag && !tags.some(function (t) { return t.tag.toLowerCase() === filter.tag.toLowerCase(); })) {
        filter.tag = null;
      }
      var visible = Notes.filterNotes(notes, filter);
      renderFilters(tags, archivedCount);
      grid.classList.toggle('archive-view', filter.archived);

      // Mémorise la position actuelle de chaque carte : après reconstruction, une carte
      // repart de là où elle était (seuls les vrais déplacements sont animés).
      var prev = {};
      Array.prototype.forEach.call(grid.children, function (c) { prev[c.dataset.id] = c.style.transform; });

      grid.textContent = '';
      colOf = {};
      visible.forEach(function (n) {
        colOf[n.id] = n.col;
        var card = renderCard(n, today);
        if (prev[n.id]) card.style.transform = prev[n.id];
        else card.classList.add('no-anim'); // nouvelle carte : apparaît directement à sa place
        grid.appendChild(card);
      });

      if (filter.archived && !visible.length && !filter.query) {
        emptyState.textContent = 'Aucune note archivée.';
      } else if (!notes.length) {
        emptyState.textContent = 'Aucune note pour l\'instant. Clique sur « + Nouvelle note » pour commencer.';
      } else if (!visible.length) {
        emptyState.textContent = 'Aucune note ne correspond'
          + (filter.tag ? ' à l\'étiquette « ' + filter.tag + ' »' : '')
          + (filter.query ? (filter.tag ? ' et' : '') + ' à la recherche « ' + filter.query.trim() + ' »' : '') + '.';
      }
      emptyState.hidden = visible.length > 0;

      layout();

      // Notes jamais placées (données d'avant les colonnes) : on mémorise la colonne où elles
      // s'affichent → la disposition ne bouge pas, et le glisser-déposer devient précis.
      // Seulement sans filtre ni recherche, pour figer la vraie disposition complète.
      if (!filter.tag && !filter.query) {
        var fix = {};
        slots.forEach(function (s) { if (!Number.isInteger(colOf[s.id])) fix[s.id] = s.col; });
        if (Object.keys(fix).length) store.setColumns(fix);
      }
      requestAnimationFrame(function () {
        Array.prototype.forEach.call(grid.querySelectorAll('.no-anim'), function (c) {
          c.classList.remove('no-anim');
        });
      });
    }

    /** Re-rendu groupé : pendant la frappe dans l'éditeur, au plus un rendu par frame. */
    function scheduleRender() {
      if (renderPending) return;
      renderPending = true;
      requestAnimationFrame(function () { renderPending = false; render(); });
    }

    global.addEventListener('resize', scheduleLayout);

    return {
      render: render,
      scheduleRender: scheduleRender,
      layout: layout,
      setFilter: setFilter,
      getFilter: function () { return { tag: filter.tag, query: filter.query, archived: filter.archived }; },
      showArchives: showArchives,
      visibleIds: visibleIds,
      getSlots: function () { return slots.slice(); },
      getGeometry: function () { return geo; },
      /** Colonne la moins haute (à égalité : la plus à gauche) → accueille une nouvelle note. */
      shortestColumn: function () {
        if (!geo) return 0;
        var h = [];
        for (var c = 0; c < geo.columns; c++) h.push(0);
        slots.forEach(function (s) { h[s.col] = Math.max(h[s.col], s.y + s.h); });
        var best = 0;
        for (var i = 1; i < h.length; i++) if (h[i] < h[best]) best = i;
        return best;
      },
      suppressNextClick: function () { suppressClick = true; setTimeout(function () { suppressClick = false; }, 0); },
      grid: grid,
      cardWidth: cardWidth,
      GAP: GAP
    };
  }

  Notes.createUI = createUI;
})(window);
