/*
 * workdays.js — Calculs de dates en jours ouvrés (lundi → vendredi) et urgence
 * des tâches à délai. Logique pure, sans DOM.
 *
 * Toutes les dates sont des chaînes 'AAAA-MM-JJ'. Les calculs se font en UTC
 * à minuit pour éviter les pièges des changements d'heure.
 *
 * Expose : window.Notes.workdays
 */
(function (global) {
  'use strict';

  var Notes = global.Notes || (global.Notes = {});
  var DAY = 86400000;

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /** Date du jour (heure locale du PC) au format AAAA-MM-JJ. */
  function todayISO(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function toTime(iso) {
    var p = iso.split('-').map(Number);
    return Date.UTC(p[0], p[1] - 1, p[2]);
  }

  function toISO(t) {
    var d = new Date(t);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  function isWeekend(t) {
    var wd = new Date(t).getUTCDay();
    return wd === 0 || wd === 6;
  }

  // ---------------------------------------------------------------- jours fériés (France)
  // Calculés localement, sans connexion : 11 jours fériés légaux, dont 3 liés à Pâques.
  // Le lundi de Pentecôte est compté comme férié.

  /** Dimanche de Pâques (algorithme de Meeus / Jones / Butcher), en temps UTC. */
  function easterSunday(year) {
    var a = year % 19, b = Math.floor(year / 100), c = year % 100;
    var d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    var g = Math.floor((b - f + 1) / 3);
    var h = (19 * a + b - d - g + 15) % 30;
    var i = Math.floor(c / 4), k = c % 4;
    var l = (32 + 2 * e + 2 * i - h - k) % 7;
    var m = Math.floor((a + 11 * h + 22 * l) / 451);
    var month = Math.floor((h + l - 7 * m + 114) / 31);
    var day = ((h + l - 7 * m + 114) % 31) + 1;
    return Date.UTC(year, month - 1, day);
  }

  var holidayCache = {};

  /** { 'AAAA-MM-JJ': 'nom' } des jours fériés d'une année. */
  function frenchHolidays(year) {
    if (holidayCache[year]) return holidayCache[year];
    var easter = easterSunday(year);
    var h = {};
    function fixed(mmdd, name) { h[year + '-' + mmdd] = name; }
    function fromEaster(days, name) { h[toISO(easter + days * DAY)] = name; }
    fixed('01-01', 'Jour de l\'an');
    fromEaster(1, 'Lundi de Pâques');
    fixed('05-01', 'Fête du Travail');
    fixed('05-08', 'Victoire 1945');
    fromEaster(39, 'Ascension');
    fromEaster(50, 'Lundi de Pentecôte');
    fixed('07-14', 'Fête nationale');
    fixed('08-15', 'Assomption');
    fixed('11-01', 'Toussaint');
    fixed('11-11', 'Armistice 1918');
    fixed('12-25', 'Noël');
    holidayCache[year] = h;
    return h;
  }

  /** Nom du jour férié, ou null. */
  function holidayName(iso) {
    return frenchHolidays(Number(iso.slice(0, 4)))[iso] || null;
  }

  function isWorkingDay(t) {
    return !isWeekend(t) && !holidayName(toISO(t));
  }

  /** Jours fériés tombant un jour de semaine dans ]a, b] → [{ date, name }]. */
  function holidaysBetween(aISO, bISO) {
    var out = [];
    for (var t = toTime(aISO) + DAY; t <= toTime(bISO); t += DAY) {
      var iso = toISO(t);
      var name = holidayName(iso);
      if (name && !isWeekend(t)) out.push({ date: iso, name: name });
    }
    return out;
  }

  // ---------------------------------------------------------------- jours ouvrés

  /** Date atteinte après n jours ouvrés (week-ends et jours fériés exclus). Jeudi + 5 → jeudi suivant. */
  function addWorkingDays(startISO, n) {
    var t = toTime(startISO);
    var count = 0;
    while (count < n) {
      t += DAY;
      if (isWorkingDay(t)) count += 1;
    }
    return toISO(t);
  }

  /**
   * Nombre de jours ouvrés dans l'intervalle ]a, b] (week-ends et jours fériés exclus).
   * Négatif si b est avant a. 0 si même jour.
   */
  function workingDaysBetween(aISO, bISO) {
    var a = toTime(aISO), b = toTime(bISO);
    if (a === b) return 0;
    if (b < a) return -workingDaysBetween(bISO, aISO);
    var count = 0;
    for (var t = a + DAY; t <= b; t += DAY) if (isWorkingDay(t)) count += 1;
    return count;
  }

  // Seuils d'urgence en jours ouvrés restants
  var URGENT_MAX = 1;   // J-1, jour J → urgent
  var SOON_MAX = 4;     // J-2 à J-4 → bientôt ; J-5 et plus → calme

  /**
   * Urgence d'une tâche à délai à la date `today`, selon les jours ouvrés restants.
   * @returns {{level:string, label:string, remaining:number|null}}
   *   level : 'late' (retard) | 'urgent' (J-1, jour J) | 'soon' (J-2 à J-4)
   *         | 'calm' (J-5 et plus) | 'done'
   */
  function urgency(item, today) {
    if (item.done) return { level: 'done', label: 'Fait', remaining: null };

    if (today > item.due) {
      var late = Math.max(1, workingDaysBetween(item.due, today));
      return { level: 'late', label: 'Retard ' + late + ' j', remaining: -late };
    }
    if (today === item.due) {
      return { level: 'urgent', label: 'Aujourd\'hui', remaining: 0 };
    }

    var remaining = workingDaysBetween(today, item.due);
    var level = remaining <= URGENT_MAX ? 'urgent' : (remaining <= SOON_MAX ? 'soon' : 'calm');
    return { level: level, label: 'J-' + remaining, remaining: remaining };
  }

  /** Nombre de jours calendaires de a à b (négatif si b avant a). */
  function calendarDaysBetween(aISO, bISO) {
    return Math.round((toTime(bISO) - toTime(aISO)) / DAY);
  }

  /** 'ven. 7 nov.' */
  function formatShort(iso) {
    return new Date(toTime(iso)).toLocaleDateString('fr-FR',
      { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  }

  /** 'vendredi 7 novembre 2026' */
  function formatLong(iso) {
    return new Date(toTime(iso)).toLocaleDateString('fr-FR',
      { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  Notes.workdays = {
    todayISO: todayISO,
    easterSunday: function (y) { return toISO(easterSunday(y)); },
    frenchHolidays: frenchHolidays,
    holidayName: holidayName,
    holidaysBetween: holidaysBetween,
    addWorkingDays: addWorkingDays,
    workingDaysBetween: workingDaysBetween,
    calendarDaysBetween: calendarDaysBetween,
    urgency: urgency,
    formatShort: formatShort,
    formatLong: formatLong
  };
})(window);
