/*
 * tests.js — Tests de store.js, sans outil externe.
 * Ouvrir tests/tests.html dans le navigateur : vert = tout passe.
 */
(function () {
  'use strict';

  // ------------------------------------------------------------ mini framework

  var groups = [];
  var current = null;

  function group(name, fn) {
    current = { name: name, tests: [] };
    groups.push(current);
    fn();
  }

  function test(name, fn) {
    current.tests.push({ name: name, fn: fn });
  }

  function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'assertion fausse');
  }

  function eq(actual, expected, msg) {
    var a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a !== e) throw new Error((msg ? msg + ' — ' : '') + 'obtenu ' + a + ', attendu ' + e);
  }

  function throws(fn, fragment) {
    try { fn(); } catch (e) {
      if (fragment && e.message.indexOf(fragment) === -1) {
        throw new Error('erreur levée mais message inattendu : « ' + e.message + ' »');
      }
      return;
    }
    throw new Error('une erreur était attendue');
  }

  // ------------------------------------------------------------ outils de test

  /** Faux localStorage en mémoire. */
  function FakeStorage(initial) {
    var data = initial || {};
    return {
      data: data,
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function (k, v) { data[k] = String(v); },
      removeItem: function (k) { delete data[k]; }
    };
  }

  /**
   * Store déterministe : ids n_1, i_2…, horloge qui avance d'une seconde par appel,
   * « aujourd'hui » = clock.today (jeudi 29/10/2026 par défaut, modifiable).
   */
  function makeStore(storage, clock) {
    var counter = 0;
    var t = Date.UTC(2026, 9, 31, 9, 0, 0);
    clock = clock || { today: '2026-10-29' };
    var s = Notes.createStore({
      storage: storage || FakeStorage(),
      genId: function (p) { counter += 1; return p + counter; },
      now: function () { var d = new Date(t); t += 1000; return d.toISOString(); },
      today: function () { return clock.today; }
    });
    s.load();
    return s;
  }

  function ids(notes) {
    return notes.map(function (n) { return n.id; });
  }

  // ------------------------------------------------------------ tests

  group('Chargement / sauvegarde', function () {
    test('stockage vide → aucune note', function () {
      var s = Notes.createStore({ storage: FakeStorage() });
      var r = s.load();
      eq(r, { ok: true, empty: true });
      eq(s.getNotes(), []);
    });

    test('les données survivent à un rechargement', function () {
      var st = FakeStorage();
      var s1 = makeStore(st);
      var n = s1.addNote({ title: 'Courses' });
      s1.addItem(n.id, { type: 'task', text: 'Pain' });
      s1.addItem(n.id, { type: 'deadline', text: 'Rapport', days: 5 });

      var s2 = makeStore(st);
      var notes = s2.getNotes();
      eq(notes.length, 1);
      eq(notes[0].title, 'Courses');
      eq(notes[0].items[0].text, 'Pain');
      eq(notes[0].items[1].due, '2026-11-05');
    });

    test('format enregistré : { version: 1, notes: [...] } sous la clé notes-app-v1', function () {
      var st = FakeStorage();
      makeStore(st).addNote({ title: 'A' });
      var saved = JSON.parse(st.getItem('notes-app-v1'));
      eq(saved.version, 1);
      eq(saved.notes.length, 1);
    });

    test('données corrompues → sauvegardées à part, pas écrasées', function () {
      var st = FakeStorage({ 'notes-app-v1': '{pas du json' });
      var s = Notes.createStore({ storage: st, now: function () { return '2026-10-31T09:00:00.000Z'; } });
      var r = s.load();
      eq(r.ok, false);
      eq(st.getItem(r.backupKey), '{pas du json');
      eq(s.getNotes(), []);
    });

    test('JSON valide mais sans tableau notes → traité comme corrompu', function () {
      var st = FakeStorage({ 'notes-app-v1': '{"foo": 1}' });
      var s = Notes.createStore({ storage: st });
      eq(s.load().ok, false);
    });

    test('stockage plein → onSaveError appelé, l\'appli continue', function () {
      var st = FakeStorage();
      st.setItem = function () { throw new Error('QuotaExceededError'); };
      var errs = [];
      var s = Notes.createStore({ storage: st, onSaveError: function (e) { errs.push(e.message); } });
      s.load();
      var n = s.addNote({ title: 'en mémoire' });
      eq(errs, ['QuotaExceededError']);
      eq(s.getNote(n.id).title, 'en mémoire');
    });

    test('onChange appelé à chaque modification, désabonnement possible', function () {
      var s = makeStore();
      var calls = 0;
      var off = s.onChange(function () { calls += 1; });
      var n = s.addNote({});
      s.updateNote(n.id, { title: 'x' });
      eq(calls, 2);
      off();
      s.deleteNote(n.id);
      eq(calls, 2);
    });
  });

  group('Notes', function () {
    test('valeurs par défaut d\'une nouvelle note', function () {
      var n = makeStore().addNote();
      eq(n.title, '');
      eq(n.color, 'default');
      eq(n.tags, []);
      eq(n.items, []);
      assert(n.createdAt && n.createdAt === n.updatedAt, 'createdAt = updatedAt à la création');
    });

    test('une nouvelle note se place en tête', function () {
      var s = makeStore();
      var a = s.addNote({ title: 'A' });
      var b = s.addNote({ title: 'B' });
      eq(ids(s.getNotes()), [b.id, a.id]);
      eq(s.getNotes().map(function (n) { return n.order; }), [0, 1]);
    });

    test('updateNote modifie titre, couleur, étiquettes et updatedAt', function () {
      var s = makeStore();
      var n = s.addNote();
      var u = s.updateNote(n.id, { title: 'Boulot', color: 'blue', tags: ['boulot'] });
      eq([u.title, u.color, u.tags], ['Boulot', 'blue', ['boulot']]);
      assert(u.updatedAt > n.updatedAt, 'updatedAt doit avancer');
    });

    test('couleur inconnue refusée', function () {
      var s = makeStore();
      throws(function () { s.addNote({ color: 'orange' }); }, 'Couleur');
      var n = s.addNote();
      throws(function () { s.updateNote(n.id, { color: 'rouge' }); }, 'Couleur');
    });

    test('champs non modifiables refusés (id, order, items…)', function () {
      var s = makeStore();
      var n = s.addNote();
      throws(function () { s.updateNote(n.id, { id: 'pirate' }); }, 'non modifiable');
      throws(function () { s.updateNote(n.id, { order: 5 }); }, 'non modifiable');
    });

    test('étiquettes : trim, vides retirés, doublons (casse) retirés', function () {
      var n = makeStore().addNote({ tags: [' perso ', '', 'Perso', 'boulot', 42] });
      eq(n.tags, ['perso', 'boulot']);
    });

    test('suppression d\'une note et renumérotation', function () {
      var s = makeStore();
      var a = s.addNote(), b = s.addNote(), c = s.addNote(); // ordre : c, b, a
      s.deleteNote(b.id);
      eq(ids(s.getNotes()), [c.id, a.id]);
      eq(s.getNotes().map(function (n) { return n.order; }), [0, 1]);
    });

    test('note inconnue → erreur claire', function () {
      var s = makeStore();
      throws(function () { s.getNote('n_999'); }, 'introuvable');
      throws(function () { s.deleteNote('n_999'); }, 'introuvable');
    });

    test('moveNote déplace et renumérote', function () {
      var s = makeStore();
      var a = s.addNote(), b = s.addNote(), c = s.addNote(); // c, b, a
      s.moveNote(c.id, 2);
      eq(ids(s.getNotes()), [b.id, a.id, c.id]);
      s.moveNote(c.id, 0);
      eq(ids(s.getNotes()), [c.id, b.id, a.id]);
      eq(s.getNotes().map(function (n) { return n.order; }), [0, 1, 2]);
    });

    test('moveNote borne un index hors limites', function () {
      var s = makeStore();
      var a = s.addNote(), b = s.addNote(); // b, a
      s.moveNote(b.id, 99);
      eq(ids(s.getNotes()), [a.id, b.id]);
      s.moveNote(b.id, -5);
      eq(ids(s.getNotes()), [b.id, a.id]);
    });

    test('l\'ordre est conservé après rechargement', function () {
      var st = FakeStorage();
      var s1 = makeStore(st);
      var a = s1.addNote(), b = s1.addNote(), c = s1.addNote();
      s1.moveNote(a.id, 0);
      eq(ids(makeStore(st).getNotes()), [a.id, c.id, b.id]);
    });

    test('les lectures renvoient des copies (pas de modification directe)', function () {
      var s = makeStore();
      var n = s.addNote({ title: 'Original' });
      var copie = s.getNote(n.id);
      copie.title = 'Modifié en douce';
      s.getNotes()[0].tags.push('intrus');
      eq(s.getNote(n.id).title, 'Original');
      eq(s.getNote(n.id).tags, []);
    });
  });

  group('Éléments : texte et tâches', function () {
    test('une carte mélange texte et tâches, dans l\'ordre d\'ajout', function () {
      var s = makeStore();
      var n = s.addNote();
      s.addItem(n.id, { type: 'text', text: 'Pour samedi' });
      s.addItem(n.id, { type: 'task', text: 'Pain' });
      s.addItem(n.id, { type: 'text', text: 'Penser au marché' });
      eq(s.getNote(n.id).items.map(function (i) { return i.type; }), ['text', 'task', 'text']);
    });

    test('case à cocher simple : non cochée, sans date ni délai', function () {
      var s = makeStore();
      var n = s.addNote();
      var t = s.addItem(n.id, { type: 'task', text: 'Lait' });
      eq(t, { id: t.id, type: 'task', text: 'Lait', done: false });
    });

    test('un texte n\'a ni done ni due', function () {
      var s = makeStore();
      var n = s.addNote();
      var t = s.addItem(n.id, { type: 'text', text: 'Note' });
      assert(!('done' in t) && !('due' in t));
    });

    test('type inconnu refusé', function () {
      var s = makeStore();
      var n = s.addNote();
      throws(function () { s.addItem(n.id, { type: 'image' }); }, 'Type inconnu');
    });

    test('délai refusé hors tâche à délai', function () {
      var s = makeStore();
      var n = s.addNote();
      throws(function () { s.addItem(n.id, { type: 'task', text: 'x', days: 3 }); }, 'délai');
      var t = s.addItem(n.id, { type: 'text', text: 'x' });
      var c = s.addItem(n.id, { type: 'task', text: 'x' });
      throws(function () { s.updateItem(n.id, t.id, { days: 3 }); }, 'réservé');
      throws(function () { s.updateItem(n.id, c.id, { days: 3 }); }, 'réservé');
      throws(function () { s.updateItem(n.id, t.id, { done: true }); }, 'réservé');
    });

    test('toggleTask coche puis décoche', function () {
      var s = makeStore();
      var n = s.addNote();
      var t = s.addItem(n.id, { type: 'task', text: 'x' });
      eq(s.toggleTask(n.id, t.id).done, true);
      eq(s.toggleTask(n.id, t.id).done, false);
    });

    test('toggleTask refusé sur un texte', function () {
      var s = makeStore();
      var n = s.addNote();
      var t = s.addItem(n.id, { type: 'text', text: 'x' });
      throws(function () { s.toggleTask(n.id, t.id); }, 'tâche');
    });

    test('modifier un élément met à jour updatedAt de la note', function () {
      var s = makeStore();
      var n = s.addNote();
      var t = s.addItem(n.id, { type: 'task', text: 'x' });
      var avant = s.getNote(n.id).updatedAt;
      s.updateItem(n.id, t.id, { text: 'y' });
      assert(s.getNote(n.id).updatedAt > avant);
    });

    test('suppression d\'un élément', function () {
      var s = makeStore();
      var n = s.addNote();
      var a = s.addItem(n.id, { text: 'a' });
      var b = s.addItem(n.id, { text: 'b' });
      s.deleteItem(n.id, a.id);
      eq(s.getNote(n.id).items.map(function (i) { return i.id; }), [b.id]);
      throws(function () { s.deleteItem(n.id, a.id); }, 'introuvable');
    });

    test('moveItem réordonne les éléments d\'une carte', function () {
      var s = makeStore();
      var n = s.addNote();
      var a = s.addItem(n.id, { text: 'a' });
      var b = s.addItem(n.id, { text: 'b' });
      var c = s.addItem(n.id, { text: 'c' });
      s.moveItem(n.id, c.id, 0);
      eq(s.getNote(n.id).items.map(function (i) { return i.text; }), ['c', 'a', 'b']);
    });

    test('addItem avec index : insertion à la position voulue (bornée)', function () {
      var s = makeStore();
      var n = s.addNote();
      s.addItem(n.id, { text: 'a' });
      s.addItem(n.id, { text: 'c' });
      s.addItem(n.id, { text: 'b' }, 1);
      s.addItem(n.id, { text: 'z' }, 99);
      s.addItem(n.id, { text: '0' }, -3);
      eq(s.getNote(n.id).items.map(function (i) { return i.text; }), ['0', 'a', 'b', 'c', 'z']);
    });

    test('élément inconnu → erreur claire', function () {
      var s = makeStore();
      var n = s.addNote();
      throws(function () { s.updateItem(n.id, 'i_999', { text: 'x' }); }, 'introuvable');
    });
  });

  group('Jours ouvrés (workdays.js)', function () {
    var W = Notes.workdays;

    test('jeudi + 5 jours ouvrés → jeudi suivant', function () {
      eq(W.addWorkingDays('2026-10-29', 5), '2026-11-05');
    });

    test('vendredi + 1 → lundi ; samedi + 1 → lundi', function () {
      eq(W.addWorkingDays('2026-10-30', 1), '2026-11-02');
      eq(W.addWorkingDays('2026-10-31', 1), '2026-11-02');
    });

    test('changement de mois / d\'année / d\'heure', function () {
      eq(W.addWorkingDays('2026-12-30', 1), '2026-12-31');   // mer → jeu
      eq(W.addWorkingDays('2026-12-31', 1), '2027-01-04');   // 1er janvier férié → lundi 4
      eq(W.addWorkingDays('2026-10-23', 2), '2026-10-27');   // passage heure d'hiver (25/10)
    });

    test('jours ouvrés entre deux dates ]a, b]', function () {
      eq(W.workingDaysBetween('2026-10-29', '2026-10-29'), 0);
      eq(W.workingDaysBetween('2026-10-29', '2026-11-05'), 5);
      eq(W.workingDaysBetween('2026-10-30', '2026-11-01'), 0);  // ven → dim
      eq(W.workingDaysBetween('2026-11-05', '2026-10-29'), -5);
    });

    test('date de Pâques (années de référence)', function () {
      eq(W.easterSunday(2024), '2024-03-31');
      eq(W.easterSunday(2025), '2025-04-20');
      eq(W.easterSunday(2026), '2026-04-05');
      eq(W.easterSunday(2027), '2027-03-28');
      eq(W.easterSunday(2038), '2038-04-25');  // date la plus tardive possible
    });

    test('11 jours fériés, dont ceux liés à Pâques', function () {
      var h = W.frenchHolidays(2026);
      eq(Object.keys(h).length, 11);
      eq(h['2026-04-06'], 'Lundi de Pâques');
      eq(h['2026-05-14'], 'Ascension');
      eq(h['2026-05-25'], 'Lundi de Pentecôte');
      eq(h['2026-11-11'], 'Armistice 1918');
      eq(W.holidayName('2026-11-12'), null);
    });

    test('jours fériés exclus des jours ouvrés', function () {
      eq(W.addWorkingDays('2026-11-10', 1), '2026-11-12');   // mer 11/11 férié
      eq(W.addWorkingDays('2026-05-13', 1), '2026-05-15');   // jeu 14/05 Ascension
      eq(W.workingDaysBetween('2026-11-09', '2026-11-13'), 3); // mar, jeu, ven
      eq(W.addWorkingDays('2026-04-03', 1), '2026-04-07');   // ven → (lundi de Pâques) → mar
    });

    test('jours fériés en semaine sur une période (week-end ignoré)', function () {
      eq(W.holidaysBetween('2026-11-09', '2026-11-13'), [{ date: '2026-11-11', name: 'Armistice 1918' }]);
      eq(W.holidaysBetween('2026-10-30', '2026-11-03'), []);  // Toussaint 2026 = dimanche
    });

    test('todayISO utilise l\'heure locale', function () {
      eq(W.todayISO(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
    });

    var task = { done: false, days: 5, start: '2026-10-29', due: '2026-11-05' };

    test('J-5 et plus → calme', function () {
      eq(W.urgency(task, '2026-10-29'), { level: 'calm', label: 'J-5', remaining: 5 });
      var long = { done: false, days: 20, start: '2026-10-29', due: '2026-11-26' };
      eq(W.urgency(long, '2026-10-29').level, 'calm');
    });

    test('J-2 à J-4 → bientôt ; J-1 → urgent', function () {
      eq(W.urgency(task, '2026-10-30').level, 'soon');    // J-4
      eq(W.urgency(task, '2026-11-03').level, 'soon');    // J-2
      eq(W.urgency(task, '2026-11-04'), { level: 'urgent', label: 'J-1', remaining: 1 });
    });

    test('le week-end ne compte pas dans les jours restants', function () {
      eq(W.urgency(task, '2026-10-31').label, 'J-4');     // samedi : lun, mar, mer, jeu
      eq(W.urgency(task, '2026-11-01').label, 'J-4');
    });

    test('jour J et retard', function () {
      eq(W.urgency(task, '2026-11-05'), { level: 'urgent', label: 'Aujourd\'hui', remaining: 0 });
      eq(W.urgency(task, '2026-11-09').label, 'Retard 2 j');  // ven 6 + lun 9
      eq(W.urgency(task, '2026-11-09').level, 'late');
    });

    test('tâche terminée', function () {
      eq(W.urgency({ done: true, days: 5, start: '2026-10-29', due: '2026-11-05' }, '2026-12-01').level, 'done');
    });
  });

  group('Éphéméride (ephemeris.js)', function () {
    var E = Notes.ephemeris;

    test('fête du jour : une entrée par jour de l\'année (29 février compris)', function () {
      eq(E.SAINTS.map(function (m) { return m.length; }), [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
      eq(E.saintOfDay('2026-10-31'), { name: 'Quentin', isEvent: false });
      eq(E.saintOfDay('2026-11-01'), { name: 'Toussaint', isEvent: true });
      eq(E.saintOfDay('2028-02-29').name, 'Auguste');
      eq(E.saintOfDay('2026-02-14').name, 'Valentin');
    });

    test('jour de l\'année', function () {
      eq(E.dayOfYear('2026-01-01'), 1);
      eq(E.dayOfYear('2026-10-31'), 304);
      eq(E.dayOfYear('2026-12-31'), 365);
      eq(E.dayOfYear('2028-12-31'), 366);
    });

    test('semaine ISO 8601 (cas limites de fin et début d\'année)', function () {
      eq(E.isoWeek('2026-10-31'), { week: 44, year: 2026 });
      eq(E.isoWeek('2026-01-01'), { week: 1, year: 2026 });   // jeudi
      eq(E.isoWeek('2026-12-31'), { week: 53, year: 2026 });  // 2026 a 53 semaines
      eq(E.isoWeek('2027-01-03'), { week: 53, year: 2026 });  // dimanche → semaine 53 de 2026
      eq(E.isoWeek('2027-01-04'), { week: 1, year: 2027 });
      eq(E.isoWeek('2024-12-30'), { week: 1, year: 2025 });  // lundi → semaine 1 de 2025
    });

    test('jours particuliers 2026', function () {
      eq(E.specialDays('2026-04-05'), ['Pâques']);
      eq(E.specialDays('2026-05-24'), ['Pentecôte']);
      eq(E.specialDays('2026-05-31'), ['Fête des mères']);
      eq(E.specialDays('2026-06-21'), ['Fête des pères']);
      eq(E.specialDays('2026-03-29'), ['Passage à l\'heure d\'été (+1 h)']);
      eq(E.specialDays('2026-10-24'), ['Cette nuit : passage à l\'heure d\'hiver (−1 h)']);
      eq(E.specialDays('2026-10-25'), ['Passage à l\'heure d\'hiver (−1 h)']);
      eq(E.specialDays('2026-10-31'), []);
    });

    test('fête des mères décalée quand elle tombe le jour de la Pentecôte', function () {
      eq(E.specialDays('2027-05-30'), ['Fête des mères']);   // cas normal : dernier dimanche de mai
      // 2045 : Pentecôte le 28 mai = dernier dimanche de mai → fête des mères le 4 juin
      eq(E.specialDays('2045-05-28'), ['Pentecôte']);
      eq(E.specialDays('2045-06-04'), ['Fête des mères']);
    });

    test('lever / coucher du soleil à Toulouse (± 5 min)', function () {
      function hm(t) { var d = new Date(t); return d.getUTCHours() * 60 + d.getUTCMinutes(); }
      function near(t, h, m) { return Math.abs(hm(t) - (h * 60 + m)) <= 5; }
      var juin = E.sunTimes('2026-06-21'), dec = E.sunTimes('2026-12-21');
      assert(near(juin.rise, 4, 13) && near(juin.set, 19, 39), 'solstice d\'été (UTC) : ' + hm(juin.rise) + ' / ' + hm(juin.set));
      assert(near(dec.rise, 7, 25) && near(dec.set, 16, 24), 'solstice d\'hiver (UTC) : ' + hm(dec.rise) + ' / ' + hm(dec.set));
    });

    test('durée du jour : raccourcit en automne, rallonge au printemps', function () {
      var aut = E.dayLength('2026-10-31'), pri = E.dayLength('2026-03-20');
      assert(aut.delta < 0 && pri.delta > 0, 'automne ' + aut.delta + ' min, printemps ' + pri.delta + ' min');
      assert(aut.minutes > 9 * 60 && aut.minutes < 11 * 60, 'fin octobre ≈ 10 h : ' + aut.minutes);
    });
  });

  group('Tâches à délai (store)', function () {
    test('création : début = aujourd\'hui, échéance en jours ouvrés', function () {
      var s = makeStore();
      var n = s.addNote();
      var t = s.addItem(n.id, { type: 'deadline', text: 'Rapport', days: 5 });
      eq(t, { id: t.id, type: 'deadline', text: 'Rapport', done: false,
              days: 5, start: '2026-10-29', due: '2026-11-05', doneAt: null });
    });

    test('délais invalides refusés', function () {
      var s = makeStore();
      var n = s.addNote();
      [0, -1, 2.5, 'abc', 366, undefined].forEach(function (d) {
        throws(function () { s.addItem(n.id, { type: 'deadline', text: 'x', days: d }); }, 'Délai invalide');
      });
      eq(s.addItem(n.id, { type: 'deadline', text: 'x', days: '3' }).days, 3); // saisie texte acceptée
      eq(s.addItem(n.id, { type: 'deadline', text: 'x', days: 365 }).days, 365);
    });

    test('modifier le délai recalcule l\'échéance depuis le début', function () {
      var clock = { today: '2026-10-29' };
      var s = makeStore(null, clock);
      var n = s.addNote();
      var t = s.addItem(n.id, { type: 'deadline', text: 'x', days: 5 });
      clock.today = '2026-11-02';
      var u = s.updateItem(n.id, t.id, { days: 2 });
      eq([u.start, u.due], ['2026-10-29', '2026-11-02']);
    });

    test('cocher enregistre la date de fin, décocher l\'efface', function () {
      var clock = { today: '2026-10-29' };
      var s = makeStore(null, clock);
      var n = s.addNote();
      var t = s.addItem(n.id, { type: 'deadline', text: 'x', days: 5 });
      clock.today = '2026-11-03';
      eq(s.toggleTask(n.id, t.id).doneAt, '2026-11-03');
      eq(s.toggleTask(n.id, t.id).doneAt, null);
    });

    test('liste globale : toutes cartes, triée par urgence, terminées à part', function () {
      var clock = { today: '2026-10-29' };
      var s = makeStore(null, clock);
      var a = s.addNote({ title: 'Projet A', color: 'blue' });
      var b = s.addNote({ title: 'Projet B' });
      s.addItem(a.id, { type: 'task', text: 'case simple, ignorée' });
      var t1 = s.addItem(a.id, { type: 'deadline', text: 'long', days: 10 });
      var t2 = s.addItem(b.id, { type: 'deadline', text: 'court', days: 2 });
      var t3 = s.addItem(b.id, { type: 'deadline', text: 'moyen', days: 5 });
      var t4 = s.addItem(a.id, { type: 'deadline', text: 'fini 1', days: 3 });
      var t5 = s.addItem(b.id, { type: 'deadline', text: 'fini 2', days: 3 });
      clock.today = '2026-10-30'; s.toggleTask(a.id, t4.id);
      clock.today = '2026-11-02'; s.toggleTask(b.id, t5.id);

      var r = s.getDeadlineTasks();
      eq(r.active.map(function (e) { return e.item.text; }), ['court', 'moyen', 'long']);
      eq(r.done.map(function (e) { return e.item.text; }), ['fini 2', 'fini 1']);
      eq([r.active[2].noteTitle, r.active[2].noteColor, r.active[2].noteId], ['Projet A', 'blue', a.id]);
      assert(t1 && t2 && t3);
    });

    test('la liste globale renvoie des copies', function () {
      var s = makeStore();
      var n = s.addNote();
      s.addItem(n.id, { type: 'deadline', text: 'x', days: 5 });
      s.getDeadlineTasks().active[0].item.text = 'pirate';
      eq(s.getDeadlineTasks().active[0].item.text, 'x');
    });
  });

  group('Suppression annulable et archivage', function () {
    test('supprimer puis restaurer : la note revient à sa place, intacte', function () {
      var s = makeStore();
      var c = s.addNote({ title: 'c' }), b = s.addNote({ title: 'b' }), a = s.addNote({ title: 'a' });
      s.addItem(b.id, { type: 'deadline', text: 'tâche', days: 3 });
      var before = s.getNote(b.id);
      var snap = s.deleteNote(b.id);
      eq(s.getNotes().map(function (n) { return n.title; }), ['a', 'c']);
      eq(snap.index, 1);
      s.restoreNote(snap);
      eq(s.getNotes().map(function (n) { return n.title; }), ['a', 'b', 'c']);
      eq(s.getNote(b.id).items, before.items);
      eq(s.getNotes().map(function (n) { return n.order; }), [0, 1, 2]);
      assert(a && c);
    });

    test('restaurer deux fois → refusé', function () {
      var s = makeStore();
      var snap = s.deleteNote(s.addNote({ title: 'x' }).id);
      s.restoreNote(snap);
      throws(function () { s.restoreNote(snap); }, 'déjà présente');
    });

    test('restaurer après d\'autres changements : position bornée', function () {
      var s = makeStore();
      s.addNote({ title: 'a' });
      var z = s.addNote({ title: 'z' });
      var snap = s.deleteNote(s.getNotes()[1].id); // supprime « a » (index 1)
      s.deleteNote(z.id);
      s.restoreNote(snap);
      eq(s.getNotes().map(function (n) { return n.title; }), ['a']);
    });

    test('nouvelle note non archivée ; archiver / désarchiver', function () {
      var s = makeStore();
      var n = s.addNote({ title: 'x' });
      eq(n.archived, false);
      eq(s.setArchived(n.id, true).archived, true);
      eq(s.setArchived(n.id, false).archived, false);
      throws(function () { s.updateNote(n.id, { archived: true }); }, 'non modifiable');
    });

    test('filtre : vue active par défaut, vue archives à part', function () {
      var s = makeStore();
      var a = s.addNote({ title: 'active' });
      var b = s.addNote({ title: 'archivée' });
      s.setArchived(b.id, true);
      var notes = s.getNotes();
      eq(Notes.filterNotes(notes, {}).map(function (n) { return n.title; }), ['active']);
      eq(Notes.filterNotes(notes, { archived: true }).map(function (n) { return n.title; }), ['archivée']);
      // anciennes données sans champ archived → actives
      var old = [{ id: 'o', title: 'ancienne', tags: [], items: [] }];
      eq(Notes.filterNotes(old, {}).length, 1);
      assert(a);
    });

    test('note archivée : hors du panneau des tâches et des étiquettes actives', function () {
      var s = makeStore();
      var a = s.addNote({ title: 'A', tags: ['projet'] });
      s.addItem(a.id, { type: 'deadline', text: 'tâche A', days: 3 });
      var b = s.addNote({ title: 'B', tags: ['vieux'] });
      s.addItem(b.id, { type: 'deadline', text: 'tâche B', days: 3 });
      s.setArchived(b.id, true);
      eq(s.getDeadlineTasks().active.map(function (e) { return e.item.text; }), ['tâche A']);
      eq(s.getAllTags().map(function (t) { return t.tag; }), ['projet']);
      eq(s.getAllTags(true).map(function (t) { return t.tag; }), ['vieux']);
    });

    test('sauvegarde : l\'état archivé est exporté et validé', function () {
      var s = makeStore();
      s.setArchived(s.addNote({ title: 'x' }).id, true);
      var d = s.exportData();
      var r = Notes.validateBackup(d);
      eq(r.notes[0].archived, true);
      d.notes[0].archived = 'oui';
      eq(Notes.validateBackup(d).ok, false);
      delete d.notes[0].archived;                       // ancienne sauvegarde
      eq(Notes.validateBackup(d).notes[0].archived, false);
    });
  });

  group('Sauvegarde : export / import', function () {
    function filled(storage) {
      var s = makeStore(storage);
      var a = s.addNote({ title: 'Projet', color: 'blue', tags: ['boulot'] });
      s.addItem(a.id, { type: 'text', text: 'Intro' });
      s.addItem(a.id, { type: 'task', text: 'Case' });
      s.addItem(a.id, { type: 'deadline', text: 'Rapport', days: 5 });
      s.addNote({ title: 'Courses' });
      return s;
    }

    test('export : en-tête + copie complète des notes', function () {
      var s = filled();
      var d = s.exportData();
      eq([d.app, d.version, d.notes.length], ['notes-app', 1, 2]);
      assert(typeof d.exportedAt === 'string');
      d.notes[0].title = 'modifié';
      assert(s.getNotes()[0].title !== 'modifié', 'l\'export est une copie');
    });

    test('aller-retour : export → JSON → import dans un autre store = identique', function () {
      var src = filled();
      var json = JSON.stringify(src.exportData());
      var dst = makeStore();
      dst.addNote({ title: 'sera remplacée' });
      var r = dst.importData(JSON.parse(json));
      eq(r.count, 2);
      eq(dst.getNotes(), src.getNotes());
    });

    test('import : remplace tout, et l\'ancien état peut être restauré', function () {
      var st = FakeStorage();
      var s = makeStore(st);
      s.addNote({ title: 'Avant' });
      eq(s.canUndoImport(), false);
      s.importData(filled().exportData());
      eq(s.getNotes().map(function (n) { return n.title; }), ['Courses', 'Projet']);
      eq(s.canUndoImport(), true);
      s.undoImport();
      eq(s.getNotes().map(function (n) { return n.title; }), ['Avant']);
      eq(s.canUndoImport(), false);
      throws(function () { s.undoImport(); }, 'Aucun import');
    });

    test('import refusé → aucune modification', function () {
      var s = makeStore();
      s.addNote({ title: 'Intacte' });
      throws(function () { s.importData({ foo: 1 }); }, 'pas une sauvegarde');
      eq(s.getNotes()[0].title, 'Intacte');
      eq(s.canUndoImport(), false);
    });

    test('validation : fichiers qui ne sont pas des sauvegardes', function () {
      [null, 42, 'texte', [], {}, { notes: 'x' }].forEach(function (d) {
        eq(Notes.validateBackup(d).ok, false);
      });
      eq(Notes.validateBackup({ version: 2, notes: [] }).errors[0].indexOf('plus récente') > -1, true);
      eq(Notes.validateBackup({ notes: [] }).ok, true); // sauvegarde vide valide
    });

    test('validation : erreurs précises sur les notes et éléments', function () {
      var good = filled().exportData();
      var bad = JSON.parse(JSON.stringify(good));
      // notes[0] = « Courses » (la plus récente, en tête), notes[1] = « Projet »
      bad.notes[1].color = 'orange';
      bad.notes[0].id = bad.notes[1].id;
      bad.notes[1].items[2].days = 0;
      bad.notes[1].items[1].done = 'oui';
      var r = Notes.validateBackup(bad);
      eq(r.ok, false);
      var all = r.errors.join(' / ');
      ['couleur inconnue', 'identifiant en double', 'délai invalide', 'état coché invalide'].forEach(function (frag) {
        assert(all.indexOf(frag) > -1, 'erreur attendue : ' + frag + ' (obtenu : ' + all + ')');
      });
      assert(all.indexOf('« Projet »') > -1, 'le message cite le titre de la note');
    });

    test('validation : nombre d\'erreurs limité', function () {
      var notes = [];
      for (var i = 0; i < 30; i++) notes.push({ id: '', title: 1, color: 'x', tags: 0, items: [] });
      eq(Notes.validateBackup({ notes: notes }).errors.length, 10);
    });

    test('date du dernier export et report du rappel', function () {
      var clock = { today: '2026-10-29' };
      var s = makeStore(null, clock);
      eq(s.getLastExport(), null);
      s.markExported();
      eq(s.getLastExport(), '2026-10-29');
      s.snoozeReminder();
      eq(s.getReminderSnooze(), '2026-10-29');
    });

    test('taille des stickers : défaut moyen, mémorisée, valeurs contrôlées', function () {
      var st = FakeStorage();
      var s = makeStore(st);
      eq(s.getCardSize(), 'medium');
      s.setCardSize('large');
      eq(makeStore(st).getCardSize(), 'large');           // relu après rechargement
      throws(function () { s.setCardSize('enorme'); }, 'Taille inconnue');
      st.setItem('notes-app-v1-taille', 'n\'importe quoi');
      eq(s.getCardSize(), 'medium');                       // valeur abîmée → défaut
    });

    test('rappel de sauvegarde', function () {
      var R = Notes.backupReminder;
      eq(R({ noteCount: 0, lastExport: null, today: '2026-11-10' }), { show: false, days: null });
      eq(R({ noteCount: 3, lastExport: null, today: '2026-11-10' }), { show: true, days: null });
      eq(R({ noteCount: 3, lastExport: '2026-11-04', today: '2026-11-10' }), { show: false, days: 6 });
      eq(R({ noteCount: 3, lastExport: '2026-11-03', today: '2026-11-10' }), { show: true, days: 7 });
      eq(R({ noteCount: 3, lastExport: '2026-11-03', today: '2026-11-10', snoozedOn: '2026-11-10' }).show, false);
      eq(R({ noteCount: 3, lastExport: '2026-11-03', today: '2026-11-11', snoozedOn: '2026-11-10' }).show, true);
    });
  });

  group('Étiquettes, filtre et recherche', function () {
    function sample() {
      var s = makeStore();
      var a = s.addNote({ title: 'Réunion maillage', tags: ['Boulot', 'SC8R'] });
      s.addItem(a.id, { type: 'task', text: 'Préparer les tolérances' });
      var b = s.addNote({ title: 'Match samedi', tags: ['foot'] });
      s.addItem(b.id, { type: 'deadline', text: 'Montage vidéo', days: 3 });
      s.addNote({ title: 'Courses', tags: ['perso', 'boulot'] });
      return s;
    }

    test('liste des étiquettes : sans doublon de casse, triée, comptée', function () {
      eq(sample().getAllTags(), [
        { tag: 'boulot', count: 2 }, { tag: 'foot', count: 1 },
        { tag: 'perso', count: 1 }, { tag: 'SC8R', count: 1 }
      ]);
    });

    test('filtre par étiquette (casse ignorée)', function () {
      var notes = sample().getNotes();
      eq(Notes.filterNotes(notes, { tag: 'BOULOT' }).map(function (n) { return n.title; }),
         ['Courses', 'Réunion maillage']);
      eq(Notes.filterNotes(notes, { tag: 'inconnue' }), []);
      eq(Notes.filterNotes(notes, {}).length, 3);
    });

    test('recherche : titre, éléments, étiquettes, accents ignorés', function () {
      var notes = sample().getNotes();
      var t = function (q) { return Notes.filterNotes(notes, { query: q }).map(function (n) { return n.title; }); };
      eq(t('reunion'), ['Réunion maillage']);
      eq(t('TOLERANCES'), ['Réunion maillage']);  // texte d'un élément
      eq(t('vidéo'), ['Match samedi']);           // tâche à délai
      eq(t('sc8r'), ['Réunion maillage']);        // étiquette
      eq(t('  '), ['Courses', 'Match samedi', 'Réunion maillage']);
    });

    test('recherche multi-mots (tous requis) combinée au filtre', function () {
      var notes = sample().getNotes();
      eq(Notes.filterNotes(notes, { query: 'maillage préparer' }).length, 1);
      eq(Notes.filterNotes(notes, { query: 'maillage foot' }).length, 0);
      eq(Notes.filterNotes(notes, { tag: 'foot', query: 'courses' }).length, 0);
    });
  });

  group('Glisser-déposer (calculs)', function () {
    test('dropIndex sans filtre = position visible', function () {
      var all = ['a', 'b', 'c', 'd'];
      eq(Notes.dropIndex(all, ['b', 'a', 'c', 'd'], 'a'), 1);
      eq(Notes.dropIndex(all, ['b', 'c', 'd', 'a'], 'a'), 3);
      eq(Notes.dropIndex(all, ['d', 'a', 'b', 'c'], 'd'), 0);
    });

    test('dropIndex avec filtre : se place avant la voisine visible suivante', function () {
      // visibles : a, c, e (b et d masquées). On glisse e entre a et c.
      var all = ['a', 'b', 'c', 'd', 'e'];
      var idx = Notes.dropIndex(all, ['a', 'e', 'c'], 'e');
      var res = all.filter(function (x) { return x !== 'e'; });
      res.splice(idx, 0, 'e');
      eq(res, ['a', 'b', 'e', 'c', 'd']);
    });

    test('dropIndex avec filtre : en dernier → juste après la précédente visible', function () {
      var all = ['a', 'b', 'c', 'd'];
      var idx = Notes.dropIndex(all, ['c', 'a'], 'a');   // visibles a, c ; a passe après c
      var res = all.filter(function (x) { return x !== 'a'; });
      res.splice(idx, 0, 'a');
      eq(res, ['b', 'c', 'a', 'd']);
    });

    test('dropIndex : carte seule visible → ne bouge pas', function () {
      eq(Notes.dropIndex(['a', 'b', 'c'], ['b'], 'b'), 1);
    });

    test('moveNote + dropIndex de bout en bout', function () {
      var s = makeStore();
      var c = s.addNote({ title: 'c' }), b = s.addNote({ title: 'b' }), a = s.addNote({ title: 'a' });
      var all = s.getNotes().map(function (n) { return n.id; }); // a, b, c
      s.moveNote(a.id, Notes.dropIndex(all, [b.id, c.id, a.id], a.id));
      eq(s.getNotes().map(function (n) { return n.title; }), ['b', 'c', 'a']);
    });

    test('slotAt : emplacement sous le pointeur', function () {
      var slots = [{ x: 0, y: 0, h: 100 }, { x: 256, y: 0, h: 50 }, { x: 0, y: 116, h: 80 }];
      eq(Notes.slotAt(slots, 10, 10, 240), 0);
      eq(Notes.slotAt(slots, 300, 40, 240), 1);
      eq(Notes.slotAt(slots, 300, 60, 240), -1);  // sous la carte courte
      eq(Notes.slotAt(slots, 245, 10, 240), -1);  // dans l'espace entre colonnes
      eq(Notes.slotAt(slots, 100, 150, 240), 2);
    });
  });

  group('Fermeture de l\'éditeur (finalizeNote)', function () {
    test('note sans titre ni élément → supprimée', function () {
      var s = makeStore();
      var n = s.addNote();
      eq(s.finalizeNote(n.id), { deleted: true });
      eq(s.getNotes(), []);
    });

    test('titre fait d\'espaces + éléments vides → supprimée', function () {
      var s = makeStore();
      var n = s.addNote({ title: '   ' });
      s.addItem(n.id, { type: 'task', text: '' });
      s.addItem(n.id, { type: 'text', text: '  \n ' });
      eq(s.finalizeNote(n.id).deleted, true);
    });

    test('éléments vides retirés, éléments remplis conservés', function () {
      var s = makeStore();
      var n = s.addNote();
      s.addItem(n.id, { type: 'task', text: 'Pain' });
      s.addItem(n.id, { type: 'task', text: '' });
      s.addItem(n.id, { type: 'text', text: 'Note' });
      eq(s.finalizeNote(n.id).deleted, false);
      eq(s.getNote(n.id).items.map(function (i) { return i.text; }), ['Pain', 'Note']);
    });

    test('titre seul → note conservée', function () {
      var s = makeStore();
      var n = s.addNote({ title: 'Juste un titre' });
      eq(s.finalizeNote(n.id).deleted, false);
      eq(s.getNotes().length, 1);
    });

    test('rien à nettoyer → aucune sauvegarde inutile', function () {
      var s = makeStore();
      var n = s.addNote({ title: 'T' });
      s.addItem(n.id, { text: 'x' });
      var calls = 0;
      s.onChange(function () { calls += 1; });
      s.finalizeNote(n.id);
      eq(calls, 0);
    });
  });

  group('Placement maçonnerie (layout.js)', function () {
    var opt = { containerWidth: 1000, cardWidth: 240, gap: 16 };

    test('nombre de colonnes selon la largeur', function () {
      // 4 colonnes = 4*240 + 3*16 = 1008 > 1000 → 3 colonnes
      eq(Notes.masonry([], opt).columns, 3);
      eq(Notes.masonry([], { containerWidth: 1008, cardWidth: 240, gap: 16 }).columns, 4);
      eq(Notes.masonry([], { containerWidth: 100, cardWidth: 240, gap: 16 }).columns, 1);
    });

    test('grille vide → hauteur 0', function () {
      eq(Notes.masonry([], opt).height, 0);
    });

    test('première ligne remplie de gauche à droite, grille centrée', function () {
      var r = Notes.masonry([100, 100, 100], opt);
      // largeur grille = 3*240 + 2*16 = 752 → décalage (1000-752)/2 = 124
      eq(r.width, 752);
      eq(r.positions, [{ x: 124, y: 0 }, { x: 380, y: 0 }, { x: 636, y: 0 }]);
    });

    test('carte suivante dans la colonne la moins haute', function () {
      var r = Notes.masonry([300, 100, 200, 50], opt);
      // colonnes après 1re ligne : 316, 116, 216 → 4e carte en colonne 2 (x=380), y=116
      eq(r.positions[3], { x: 380, y: 116 });
    });

    test('à égalité, la colonne la plus à gauche', function () {
      var r = Notes.masonry([100, 100, 100, 80], opt);
      eq(r.positions[3], { x: 124, y: 116 });
    });

    test('hauteur totale = colonne la plus haute (sans gap final)', function () {
      var r = Notes.masonry([300, 100, 200, 50], opt);
      eq(r.height, 300);
      var r2 = Notes.masonry([100, 100, 100, 250], opt);
      eq(r2.height, 366); // 100 + 16 + 250
    });

    test('une seule colonne : cartes empilées', function () {
      var r = Notes.masonry([50, 70], { containerWidth: 240, cardWidth: 240, gap: 16 });
      eq(r.positions, [{ x: 0, y: 0 }, { x: 0, y: 66 }]);
    });
  });

  // ------------------------------------------------------------ exécution & rendu

  var total = 0, failed = 0;
  var results = document.getElementById('results');

  groups.forEach(function (g) {
    var h = document.createElement('h2');
    h.textContent = g.name;
    results.appendChild(h);
    var ul = document.createElement('ul');
    results.appendChild(ul);

    g.tests.forEach(function (t) {
      total += 1;
      var li = document.createElement('li');
      li.textContent = t.name;
      try {
        t.fn();
        li.className = 'pass';
      } catch (e) {
        failed += 1;
        li.className = 'fail';
        var err = document.createElement('span');
        err.className = 'err';
        err.textContent = e.message;
        li.appendChild(err);
      }
      ul.appendChild(li);
    });
  });

  var summary = document.getElementById('summary');
  summary.textContent = failed === 0
    ? '✔ ' + total + ' tests réussis'
    : '✘ ' + failed + ' échec(s) sur ' + total + ' tests';
  summary.className = failed === 0 ? 'ok' : 'fail';

  // Pour un lancement automatisé éventuel
  window.__testResults = { total: total, failed: failed };
})();
