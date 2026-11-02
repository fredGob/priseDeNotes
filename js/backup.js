/*
 * backup.js — Sauvegarde : menu ⋮, export / import JSON, rappel de sauvegarde.
 *
 * - Export : téléchargement de notes-sauvegarde-AAAA-MM-JJ.json
 * - Import : remplace TOUTES les notes après confirmation ; annulable juste après.
 * - Rappel : bandeau discret si jamais exporté ou dernier export ≥ 7 jours.
 *
 * Expose : window.Notes.createBackup({ store, showBanner })
 */
(function (global) {
  'use strict';

  var Notes = global.Notes || (global.Notes = {});

  function createBackup(opts) {
    var store = opts.store;
    var showBanner = opts.showBanner;
    var W = Notes.workdays;
    var el = Notes.view.el;

    var btnMenu = document.getElementById('btn-menu');
    var menu = document.getElementById('menu');
    var menuInfo = document.getElementById('menu-info');
    var fileInput = document.getElementById('file-import');
    var reminder = document.getElementById('backup-reminder');
    var reminderText = reminder.querySelector('.reminder-text');

    // ---------------------------------------------------------- menu ⋮

    function lastExportText() {
      var last = store.getLastExport();
      if (!last) return 'Aucune sauvegarde pour l\'instant';
      var d = W.calendarDaysBetween(last, W.todayISO());
      return 'Dernière sauvegarde : ' + W.formatShort(last)
        + (d === 0 ? ' (aujourd\'hui)' : d > 0 ? ' (il y a ' + d + ' j)' : ''); // d < 0 : horloge du PC déréglée
    }

    function openMenu() {
      menuInfo.textContent = lastExportText();
      menu.hidden = false;
      btnMenu.setAttribute('aria-expanded', 'true');
      menu.querySelector('[role=menuitem]').focus();
    }

    function closeMenu() {
      menu.hidden = true;
      btnMenu.setAttribute('aria-expanded', 'false');
    }

    btnMenu.addEventListener('click', function () {
      if (menu.hidden) openMenu(); else closeMenu();
    });

    document.addEventListener('mousedown', function (e) {
      if (!menu.hidden && !e.target.closest('.menu-wrap')) closeMenu();
    });

    menu.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeMenu(); btnMenu.focus(); }
    });

    menu.addEventListener('click', function (e) {
      var item = e.target.closest('[data-action]');
      if (!item) return;
      closeMenu();
      if (item.dataset.action === 'export') doExport();
      if (item.dataset.action === 'import') { fileInput.value = ''; fileInput.click(); }
    });

    // ---------------------------------------------------------- export

    function doExport() {
      var data = store.exportData();
      var name = 'notes-sauvegarde-' + W.todayISO() + '.json';
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);

      store.markExported();
      refreshReminder();
      showBanner('Sauvegarde exportée : ' + name + ' (' + data.notes.length + ' notes). '
        + 'Range-la dans un dossier hors du navigateur.', 'success', null, 8000);
    }

    // ---------------------------------------------------------- import

    fileInput.addEventListener('change', function () {
      var file = fileInput.files[0];
      if (!file) return;
      file.text().then(function (txt) {
        var data;
        try { data = JSON.parse(txt); } catch (e) {
          showBanner('« ' + file.name + ' » n\'est pas un fichier JSON lisible.', 'error');
          return;
        }
        var v = Notes.validateBackup(data);
        if (!v.ok) {
          var list = v.errors.slice(0, 3).join(' ; ') + (v.errors.length > 3 ? ' …' : '');
          showBanner('Import impossible, le fichier est refusé : ' + list, 'error');
          return;
        }
        var current = store.getNotes().length;
        var date = v.exportedAt ? ' (sauvegarde du ' + W.formatLong(v.exportedAt.slice(0, 10)) + ')' : '';
        confirmDialog({
          title: 'Remplacer toutes les notes ?',
          message: 'Tes ' + current + ' notes actuelles vont être remplacées par les '
            + v.count + ' notes de « ' + file.name + ' »' + date + '.',
          detail: 'Tu pourras annuler juste après l\'import.',
          confirmLabel: 'Remplacer'
        }).then(function (ok) {
          if (!ok) return;
          var r = store.importData(data);
          refreshReminder();
          showBanner('Import réussi : ' + r.count + ' notes restaurées.', 'success', [{
            label: 'Annuler l\'import',
            onClick: function () {
              store.undoImport();
              refreshReminder();
              showBanner('Import annulé : tes notes précédentes sont revenues.', 'info', null, 6000);
            }
          }]);
        });
      });
    });

    // ---------------------------------------------------------- boîte de confirmation

    var dlgOverlay = el('div', 'overlay dialog-overlay');
    dlgOverlay.hidden = true;
    var dlg = el('div', 'dialog');
    dlg.setAttribute('role', 'alertdialog');
    dlg.setAttribute('aria-modal', 'true');
    var dlgTitle = el('h2', 'dialog-title');
    var dlgMsg = el('p', 'dialog-msg');
    var dlgDetail = el('p', 'dialog-detail');
    var dlgFoot = el('div', 'dialog-footer');
    var dlgCancel = el('button', 'btn-secondary', 'Annuler');
    var dlgOk = el('button', 'btn-danger-solid');
    dlgCancel.type = dlgOk.type = 'button';
    dlgFoot.appendChild(dlgCancel);
    dlgFoot.appendChild(dlgOk);
    [dlgTitle, dlgMsg, dlgDetail, dlgFoot].forEach(function (x) { dlg.appendChild(x); });
    dlgOverlay.appendChild(dlg);
    document.body.appendChild(dlgOverlay);

    /** Boîte de confirmation maison (pas de confirm() navigateur). → Promise<boolean> */
    function confirmDialog(o) {
      return new Promise(function (resolve) {
        dlgTitle.textContent = o.title;
        dlgMsg.textContent = o.message;
        dlgDetail.textContent = o.detail || '';
        dlgOk.textContent = o.confirmLabel || 'Confirmer';
        dlgOverlay.hidden = false;
        dlgCancel.focus(); // par sécurité, le focus va sur « Annuler »

        function done(result) {
          dlgOverlay.hidden = true;
          dlgOk.removeEventListener('click', onOk);
          dlgCancel.removeEventListener('click', onCancel);
          dlgOverlay.removeEventListener('mousedown', onOutside);
          document.removeEventListener('keydown', onKey);
          resolve(result);
        }
        function onOk() { done(true); }
        function onCancel() { done(false); }
        function onOutside(e) { if (e.target === dlgOverlay) done(false); }
        function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); done(false); } }

        dlgOk.addEventListener('click', onOk);
        dlgCancel.addEventListener('click', onCancel);
        dlgOverlay.addEventListener('mousedown', onOutside);
        document.addEventListener('keydown', onKey);
      });
    }

    // ---------------------------------------------------------- rappel

    function refreshReminder() {
      var r = Notes.backupReminder({
        noteCount: store.getNotes().length,
        lastExport: store.getLastExport(),
        snoozedOn: store.getReminderSnooze(),
        today: W.todayISO()
      });
      reminder.hidden = !r.show;
      if (r.show) {
        reminderText.textContent = r.days === null
          ? 'Tes notes ne sont stockées que dans ce navigateur et n\'ont jamais été sauvegardées.'
          : 'Dernière sauvegarde il y a ' + r.days + ' jours.';
      }
    }

    reminder.querySelector('[data-action=export]').addEventListener('click', doExport);
    reminder.querySelector('[data-action=snooze]').addEventListener('click', function () {
      store.snoozeReminder();
      refreshReminder();
    });

    return {
      refreshReminder: refreshReminder,
      doExport: doExport,
      confirmDialog: confirmDialog
    };
  }

  Notes.createBackup = createBackup;
})(window);
