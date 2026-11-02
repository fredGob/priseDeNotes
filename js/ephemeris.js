/*
 * ephemeris.js — Données de l'encart date / heure / éphéméride. Logique pure, sans DOM,
 * entièrement calculée localement (aucune connexion).
 *
 *  - numéro de semaine ISO 8601, jour de l'année ;
 *  - fête du jour (calendrier français usuel) ;
 *  - lever / coucher du soleil (algorithme NOAA simplifié, précision ~1-2 min) ;
 *  - jours particuliers : Pâques, Pentecôte, fêtes des mères / pères, changements d'heure.
 *
 * Expose : window.Notes.ephemeris
 */
(function (global) {
  'use strict';

  var Notes = global.Notes || (global.Notes = {});
  var DAY = 86400000;

  // Lieu utilisé pour le soleil : Toulouse. Modifiable ici.
  var PLACE = { name: 'Toulouse', lat: 43.6047, lon: 1.4442 };

  function toTime(iso) {
    var p = iso.split('-').map(Number);
    return Date.UTC(p[0], p[1] - 1, p[2]);
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toISO(t) {
    var d = new Date(t);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }

  // ---------------------------------------------------------------- calendrier

  /** Jour de l'année (1er janvier = 1). */
  function dayOfYear(iso) {
    return Math.round((toTime(iso) - Date.UTC(Number(iso.slice(0, 4)), 0, 1)) / DAY) + 1;
  }

  function daysInYear(year) { return isLeap(year) ? 366 : 365; }

  /**
   * Semaine ISO 8601 : la semaine 1 contient le premier jeudi de l'année.
   * @returns {{week:number, year:number}}  year = année ISO (peut différer fin déc. / début janv.)
   */
  function isoWeek(iso) {
    var t = toTime(iso);
    var wd = (new Date(t).getUTCDay() + 6) % 7;     // lundi = 0 … dimanche = 6
    var thursday = t + (3 - wd) * DAY;              // jeudi de la même semaine
    var year = new Date(thursday).getUTCFullYear();
    var week = Math.floor((thursday - Date.UTC(year, 0, 1)) / DAY / 7) + 1;
    return { week: week, year: year };
  }

  // ---------------------------------------------------------------- fête du jour
  // Calendrier français usuel. « ! » = fête ou événement (affiché tel quel, pas un prénom).

  var SAINTS = [
    /* janvier */ ['!Jour de l\'an', 'Basile', 'Geneviève', 'Odilon', 'Édouard', 'Mélaine', 'Raymond', 'Lucien',
      'Alix', 'Guillaume', 'Paulin', 'Tatiana', 'Yvette', 'Nina', 'Rémi', 'Marcel', 'Roseline', 'Prisca', 'Marius',
      'Sébastien', 'Agnès', 'Vincent', 'Barnard', 'François de Sales', '!Conversion de saint Paul', 'Paule',
      'Angèle', 'Thomas d\'Aquin', 'Gildas', 'Martine', 'Marcelle'],
    /* février */ ['Ella', '!Chandeleur', 'Blaise', 'Véronique', 'Agathe', 'Gaston', 'Eugénie', 'Jacqueline',
      'Apolline', 'Arnaud', '!Notre-Dame de Lourdes', 'Félix', 'Béatrice', 'Valentin', 'Claude', 'Julienne',
      'Alexis', 'Bernadette', 'Gabin', 'Aimée', 'Damien', 'Isabelle', 'Lazare', 'Modeste', 'Roméo', 'Nestor',
      'Honorine', 'Romain', 'Auguste'],
    /* mars */ ['Aubin', 'Charles le Bon', 'Guénolé', 'Casimir', 'Olive', 'Colette', 'Félicité', 'Jean de Dieu',
      'Françoise', 'Vivien', 'Rosine', 'Justine', 'Rodrigue', 'Mathilde', 'Louise', 'Bénédicte', 'Patrice',
      'Cyrille', 'Joseph', 'Herbert', 'Clémence', 'Léa', 'Victorien', 'Catherine de Suède', '!Annonciation',
      'Larissa', 'Habib', 'Gontran', 'Gwladys', 'Amédée', 'Benjamin'],
    /* avril */ ['Hugues', 'Sandrine', 'Richard', 'Isidore', 'Irène', 'Marcellin', 'Jean-Baptiste de la Salle',
      'Julie', 'Gautier', 'Fulbert', 'Stanislas', 'Jules', 'Ida', 'Maxime', 'Paterne', 'Benoît-Joseph', 'Anicet',
      'Parfait', 'Emma', 'Odette', 'Anselme', 'Alexandre', 'Georges', 'Fidèle', 'Marc', 'Alida', 'Zita',
      'Valérie', 'Catherine de Sienne', 'Robert'],
    /* mai */ ['!Fête du Travail', 'Boris', 'Philippe et Jacques', 'Sylvain', 'Judith', 'Prudence', 'Gisèle',
      'Désiré', 'Pacôme', 'Solange', 'Estelle', 'Achille', 'Rolande', 'Matthias', 'Denise', 'Honoré', 'Pascal',
      'Éric', 'Yves', 'Bernardin', 'Constantin', 'Émile', 'Didier', 'Donatien', 'Sophie', 'Bérenger', 'Augustin',
      'Germain', 'Aymar', 'Ferdinand', '!Visitation'],
    /* juin */ ['Justin', 'Blandine', 'Kévin', 'Clotilde', 'Igor', 'Norbert', 'Gilbert', 'Médard', 'Diane',
      'Landry', 'Barnabé', 'Guy', 'Antoine de Padoue', 'Élisée', 'Germaine', 'Jean-François Régis', 'Hervé',
      'Léonce', 'Romuald', 'Silvère', 'Rodolphe', 'Alban', 'Audrey', 'Jean-Baptiste', 'Prosper', 'Anthelme',
      'Fernand', 'Irénée', 'Pierre et Paul', 'Martial'],
    /* juillet */ ['Thierry', 'Martinien', 'Thomas', 'Florent', 'Antoine', 'Mariette', 'Raoul', 'Thibaut',
      'Amandine', 'Ulrich', 'Benoît', 'Olivier', 'Henri et Joël', '!Fête nationale', 'Donald',
      '!Notre-Dame du Mont-Carmel', 'Charlotte', 'Frédéric', 'Arsène', 'Marina', 'Victor', 'Marie-Madeleine',
      'Brigitte', 'Christine', 'Jacques', 'Anne et Joachim', 'Nathalie', 'Samson', 'Marthe', 'Juliette',
      'Ignace de Loyola'],
    /* août */ ['Alphonse', 'Julien Eymard', 'Lydie', 'Jean-Marie Vianney', 'Abel', '!Transfiguration', 'Gaétan',
      'Dominique', 'Amour', 'Laurent', 'Claire', 'Clarisse', 'Hippolyte', 'Evrard', '!Assomption', 'Armel',
      'Hyacinthe', 'Hélène', 'Jean Eudes', 'Bernard', 'Christophe', 'Fabrice', 'Rose de Lima', 'Barthélemy',
      'Louis', 'Natacha', 'Monique', 'Augustin', 'Sabine', 'Fiacre', 'Aristide'],
    /* septembre */ ['Gilles', 'Ingrid', 'Grégoire', 'Rosalie', 'Raïssa', 'Bertrand', 'Reine', 'Adrien', 'Alain',
      'Inès', 'Adelphe', 'Apollinaire', 'Aimé', '!Croix glorieuse', 'Roland', 'Édith', 'Renaud', 'Nadège',
      'Émilie', 'Davy', 'Matthieu', 'Maurice', 'Constant', 'Thècle', 'Hermann', 'Côme et Damien',
      'Vincent de Paul', 'Venceslas', 'Michel, Gabriel et Raphaël', 'Jérôme'],
    /* octobre */ ['Thérèse de l\'Enfant-Jésus', 'Léger', 'Gérard', 'François d\'Assise', 'Fleur', 'Bruno',
      'Serge', 'Pélagie', 'Denis', 'Ghislain', 'Firmin', 'Wilfried', 'Géraud', 'Juste', 'Thérèse d\'Avila',
      'Edwige', 'Baudouin', 'Luc', 'René', 'Adeline', 'Céline', 'Élodie', 'Jean de Capistran', 'Florentin',
      'Crépin', 'Dimitri', 'Émeline', 'Simon et Jude', 'Narcisse', 'Bienvenue', 'Quentin'],
    /* novembre */ ['!Toussaint', '!Défunts', 'Hubert', 'Charles', 'Sylvie', 'Bertille', 'Carine', 'Geoffroy',
      'Théodore', 'Léon', 'Martin', 'Christian', 'Brice', 'Sidoine', 'Albert', 'Marguerite', 'Élisabeth', 'Aude',
      'Tanguy', 'Edmond', '!Présentation de Marie', 'Cécile', 'Clément', 'Flora', 'Catherine', 'Delphine',
      'Séverin', 'Jacques de la Marche', 'Saturnin', 'André'],
    /* décembre */ ['Florence', 'Viviane', 'François-Xavier', 'Barbara', 'Gérald', 'Nicolas', 'Ambroise',
      '!Immaculée Conception', 'Pierre Fourier', 'Romaric', 'Daniel', 'Jeanne-Françoise de Chantal', 'Lucie',
      'Odile', 'Ninon', 'Alice', 'Gaël', 'Gatien', 'Urbain', 'Théophile', 'Pierre Canisius',
      'Françoise-Xavière', 'Armand', 'Adèle', '!Noël', 'Étienne', 'Jean', '!Saints Innocents', 'David', 'Roger',
      'Sylvestre']
  ];

  /**
   * Fête du jour.
   * @returns {{name:string, isEvent:boolean}}  isEvent : fête religieuse / civile (pas un prénom)
   */
  function saintOfDay(iso) {
    var raw = SAINTS[Number(iso.slice(5, 7)) - 1][Number(iso.slice(8, 10)) - 1];
    return raw.charAt(0) === '!' ? { name: raw.slice(1), isEvent: true } : { name: raw, isEvent: false };
  }

  // ---------------------------------------------------------------- jours particuliers

  /** Dernier dimanche d'un mois (month : 1-12), en temps UTC. */
  function lastSunday(year, month) {
    var t = Date.UTC(year, month, 0);               // dernier jour du mois
    return t - new Date(t).getUTCDay() * DAY;
  }

  /**
   * Événements du jour (hors jours fériés, gérés par workdays.js) → [texte].
   * Annonce aussi le changement d'heure la veille.
   */
  function specialDays(iso) {
    var y = Number(iso.slice(0, 4));
    var t = toTime(iso);
    var easter = toTime(Notes.workdays.easterSunday(y));
    var out = [];
    if (t === easter) out.push('Pâques');
    if (t === easter + 49 * DAY) out.push('Pentecôte');

    // Fête des mères : dernier dimanche de mai, ou 1er dimanche de juin si c'est la Pentecôte
    var mothers = lastSunday(y, 5);
    if (mothers === easter + 49 * DAY) mothers += 7 * DAY;
    if (t === mothers) out.push('Fête des mères');
    // Fête des pères : 3e dimanche de juin
    var june1 = Date.UTC(y, 5, 1);
    var fathers = june1 + ((7 - new Date(june1).getUTCDay()) % 7) * DAY + 14 * DAY;
    if (t === fathers) out.push('Fête des pères');

    // Changements d'heure : dernier dimanche de mars (été) et d'octobre (hiver)
    var summer = lastSunday(y, 3), winter = lastSunday(y, 10);
    if (t === summer) out.push('Passage à l\'heure d\'été (+1 h)');
    if (t === summer - DAY) out.push('Cette nuit : passage à l\'heure d\'été (+1 h)');
    if (t === winter) out.push('Passage à l\'heure d\'hiver (−1 h)');
    if (t === winter - DAY) out.push('Cette nuit : passage à l\'heure d\'hiver (−1 h)');
    return out;
  }

  // ---------------------------------------------------------------- soleil

  /**
   * Lever / coucher du soleil (algorithme NOAA, réfraction standard).
   * @returns {{rise:number, set:number}|null}  instants en ms (temps universel), à afficher
   *   en heure locale ; null si pas de lever/coucher (latitudes polaires).
   */
  function sunTimes(iso, lat, lon) {
    lat = lat === undefined ? PLACE.lat : lat;
    lon = lon === undefined ? PLACE.lon : lon;
    var y = Number(iso.slice(0, 4));
    var rad = Math.PI / 180;
    var g = 2 * Math.PI / daysInYear(y) * (dayOfYear(iso) - 1);
    var eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
      - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    var decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
      + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    var cosHa = Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl);
    if (cosHa < -1 || cosHa > 1) return null;
    var ha = Math.acos(cosHa) / rad;
    var base = toTime(iso);
    return {
      rise: base + (720 - 4 * (lon + ha) - eqt) * 60000,
      set: base + (720 - 4 * (lon - ha) - eqt) * 60000
    };
  }

  /** Durée du jour (minutes) et écart avec la veille (minutes, arrondi). */
  function dayLength(iso) {
    var s = sunTimes(iso);
    var p = sunTimes(toISO(toTime(iso) - DAY));
    if (!s || !p) return null;
    var len = (s.set - s.rise) / 60000;
    return { minutes: Math.round(len), delta: Math.round(len - (p.set - p.rise) / 60000) };
  }

  Notes.ephemeris = {
    PLACE: PLACE,
    dayOfYear: dayOfYear,
    daysInYear: daysInYear,
    isoWeek: isoWeek,
    saintOfDay: saintOfDay,
    specialDays: specialDays,
    sunTimes: sunTimes,
    dayLength: dayLength,
    SAINTS: SAINTS
  };
})(window);
