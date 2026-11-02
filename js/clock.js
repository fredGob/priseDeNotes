/*
 * clock.js — Encart date / heure / éphéméride, en haut de la colonne de droite.
 * Mis à jour à chaque changement de minute. Aucune connexion : tout vient de
 * ephemeris.js et workdays.js.
 *
 * Expose : window.Notes.createClock({ root })
 */
(function (global) {
  'use strict';

  var Notes = global.Notes || (global.Notes = {});

  function createClock(opts) {
    var root = opts.root;
    var E = Notes.ephemeris;
    var W = Notes.workdays;
    var el = Notes.view.el;
    var timer = null;

    function hhmm(d) {
      return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    }

    function render() {
      var now = new Date();
      var iso = W.todayISO(now);
      var week = E.isoWeek(iso);
      var doy = E.dayOfYear(iso);
      var year = now.getFullYear();
      root.textContent = '';

      root.appendChild(el('div', 'clock-time', hhmm(now)));
      var date = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      if (now.getDate() === 1) date = date.replace(/ 1 /, ' 1er ');   // « 1er novembre »
      root.appendChild(el('div', 'clock-date', date.charAt(0).toUpperCase() + date.slice(1)));
      root.appendChild(el('div', 'clock-week',
        'Semaine ' + week.week + ' · Jour ' + doy + ' / ' + E.daysInYear(year)));

      var eph = el('div', 'clock-eph');

      var holiday = W.holidayName(iso);
      if (holiday) eph.appendChild(el('div', 'clock-line clock-holiday', 'Férié : ' + holiday));
      E.specialDays(iso).forEach(function (txt) {
        eph.appendChild(el('div', 'clock-line clock-special', txt));
      });

      var saint = E.saintOfDay(iso);
      if (!(saint.isEvent && holiday === saint.name)) {      // évite « Toussaint » deux fois
        eph.appendChild(el('div', 'clock-line', saint.isEvent ? saint.name : 'Fête du jour : ' + saint.name));
      }

      var sun = E.sunTimes(iso);
      if (sun) {
        var line = el('div', 'clock-line clock-sun');
        line.title = 'Lever et coucher du soleil à ' + E.PLACE.name;
        line.textContent = 'Soleil ' + hhmm(new Date(sun.rise)) + ' – ' + hhmm(new Date(sun.set));
        var len = E.dayLength(iso);
        if (len && len.delta !== 0) {
          line.appendChild(el('span', 'clock-delta',
            (len.delta > 0 ? '  +' : '  −') + Math.abs(len.delta) + ' min'));
          line.lastChild.title = len.delta > 0 ? 'Les jours rallongent' : 'Les jours raccourcissent';
        }
        eph.appendChild(line);
      }
      root.appendChild(eph);
    }

    /** Re-rendu pile au changement de minute. */
    function schedule() {
      clearTimeout(timer);
      var now = new Date();
      var ms = 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50;
      timer = setTimeout(function () { render(); schedule(); }, ms);
    }

    // Retour sur l'onglet (PC sorti de veille…) → remise à l'heure immédiate
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { render(); schedule(); }
    });

    render();
    schedule();
    return { render: render };
  }

  Notes.createClock = createClock;
})(window);
