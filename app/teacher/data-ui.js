/*
 * dataView (L6 teacher): tab 'data', "Data on this device" (DESIGN 17.8, 18, 10.3, D1, D10).
 * Where the data is kept (storage mode and reason, the per-address rule), exports (all data as JSON,
 * the three CSV files), import (a .json file: validated, then a summary with counts per store and
 * the first 20 differences; a radio preset to "Keep what is on this device"; nothing changes until
 * Confirm; Cancel changes nothing; the result in an aria-live region), the latest import and the
 * report of the older save from this device. Every file name and record text is set with h() (text only).
 */
(function () {
  'use strict';

  NBA.define('dataView', ['config', 'util', 'repo', 'learning', 'exporter', 'importer', 'teacherUI'],
    (config, util, repo, learning, exporter, importer, ui) => {
      const { h } = ui;
      const view = { plan: null, choice: 'keep', fileName: null };
      const $ = (id) => document.getElementById(id);
      const num = (n) => Number(n).toLocaleString('en-GB');
      const when = (ms) => (typeof ms === 'number' ? new Date(ms).toLocaleString('en-GB') : '');
      const V1_REASON = {
        unreadable: 'it could not be read', unsupported_version: 'it has a version this app does not know',
        verify_failed: 'the saved copy could not be checked', write_failed: 'saving it failed'
      };
      const EXPORTS = [
        ['json', 'All data (JSON)'], ['attempts', 'Answers (CSV)'], ['mastery', 'Concept summary (CSV)'], ['assessments', 'Ninja Check results (CSV)']
      ];

      function storageLines() {
        const here = exporter.origin || '';
        const lines = repo.mode === 'memory'
          ? ['Not saved: ' + (repo.READABLE[repo.reason] || repo.reason || 'storage is unavailable') + ' (' + (repo.reason || 'unknown') +
            '). Anything recorded now is lost when the page closes.']
          : ['Saved in this browser on this device, for this address only' + (here ? ': ' + here : '') + '.'];
        return lines.concat(['Each address keeps its own data. Opening index.html directly (file://) and opening it through python tools/serve.py ' +
          '(http://127.0.0.1:8000/) use separate storage. To move data between them, or to another device, export it here and import it there.']);
      }

      async function metaLines() {
        let mig = null, last = null;
        try { mig = await repo.get('meta', 'v1Migration'); last = await repo.get('meta', 'lastImport'); } catch (e) { /* shown as none */ }
        const older = !mig ? 'Older save from this device: none found.'
          : (mig.status === 'done' ? 'Older save from this device: imported on ' + util.localDate(mig.migratedAt) + '.'
            : 'Older save from this device: kept unchanged, not imported: ' + (V1_REASON[mig.report && mig.report.status] || 'it could not be used') + '.');
        const latest = last ? 'Latest import: ' + when(last.at) + ', from a file exported ' + last.sourceExportedAt +
          (last.sourceOrigin ? ' at ' + last.sourceOrigin : '') + '.' : 'Latest import: none.';
        return [older, latest];
      }

      async function render(root) {
        root.appendChild(h('h1', { text: 'Data on this device' }));
        root.appendChild(h('section', { class: 't-card', id: 't-data-storage' }, [h('h2', { text: 'Where the data is kept' })]
          .concat(storageLines().map((t) => h('p', { text: t })))));
        root.appendChild(h('section', { class: 't-card', id: 't-data-export' }, [
          h('h2', { text: 'Export' }),
          h('p', { class: 't-help', text: 'JSON holds everything and can be imported again. CSV files open in a spreadsheet. Files are saved on this device only.' }),
          h('div', { class: 't-actions' }, EXPORTS.map((x) => h('button', { type: 'button', class: 't-btn', 'data-t-action': 'data-export', 'data-kind': x[0], text: x[1] }))),
          h('p', { id: 't-export-msg', role: 'status', 'aria-live': 'polite' })
        ]));
        root.appendChild(h('section', { class: 't-card', id: 't-data-import' }, [
          h('h2', { text: 'Import' }),
          h('p', { class: 't-help', text: 'Choose a JSON file exported from this app. It is checked first, and nothing changes until you confirm.' }),
          h('div', { class: 't-field' }, [h('label', { for: 't-import-file', text: 'Export file (.json)' }),
            h('input', { id: 't-import-file', type: 'file', accept: '.json,application/json', 'data-t-change': 'data-import-file' })]),
          h('div', { id: 't-import-plan' }),
          h('div', { id: 't-import-result', role: 'status', 'aria-live': 'polite' })
        ]));
        root.appendChild(h('section', { class: 't-card', id: 't-data-history' }, [h('h2', { text: 'Earlier data' })]
          .concat((await metaLines()).map((t) => h('p', { text: t })))));
        if (view.plan) renderPlan();
      }

      function showResult(text, problems, isError) {
        const box = $('t-import-result');
        if (!box) return;
        box.textContent = '';
        box.appendChild(h('p', { class: isError ? 't-error' : null, id: 't-import-message', text: text }));
        if (problems && problems.length) box.appendChild(h('ul', { class: 't-list', id: 't-import-problems' }, problems.map((p) => h('li', { text: p }))));
      }

      const cellText = (row, k) => (row[k] ? num(row[k]) : '');
      function renderPlan() {
        const box = $('t-import-plan');
        if (!box) return;
        box.textContent = '';
        const p = view.plan;
        if (!p) return;
        const preview = importer.planOps(p, view.choice, util.now());
        const s = p.source;
        box.appendChild(h('h3', { text: 'What this file would change' }));
        box.appendChild(h('p', { text: 'File ' + (view.fileName || '') + ': exported ' + s.exportedAt + (s.origin ? ' at ' + s.origin : '') + ', app version ' + s.appVersion + '.' }));
        box.appendChild(h('p', { id: 't-import-mode', text: p.mode === 'empty'
          ? 'This device has no data yet, so the file is imported as it is. The empty Player 1 on this device is replaced.'
          : 'This device already has data, so the file is merged: new records are added, world progress keeps the higher stars, and nothing on this device is overwritten unless you choose it below.' }));
        const rows = p.rows.filter((r) => r.inFile > 0);
        box.appendChild(h('div', { class: 't-scroll' }, [h('table', { class: 't-table', id: 't-import-counts' }, [
          h('thead', {}, [h('tr', {}, ['Records', 'In the file', 'New', 'Already here', 'Merged', 'Different', 'Not imported'].map((t) => h('th', { scope: 'col', text: t })))]),
          h('tbody', {}, rows.map((r) => h('tr', { 'data-store': r.store }, [h('th', { scope: 'row', text: r.type }), h('td', { text: num(r.inFile) }),
            h('td', { text: cellText(r, 'add') }), h('td', { text: cellText(r, 'same') }), h('td', { text: cellText(r, 'merge') }), h('td', { text: cellText(r, 'conflict') }),
            h('td', { text: r.skipped ? 'skipped (device settings)' : (r.rebuilt ? 'rebuilt from answers' : '') })])))])]));
        if (p.conflicts.length) {
          const shown = p.conflicts.slice(0, config.import.conflictsShown);
          box.appendChild(h('h3', { text: 'Different on this device (' + num(p.conflicts.length) + ')' + (p.conflicts.length > shown.length ? ', first ' + shown.length + ':' : '') }));
          box.appendChild(h('ul', { class: 't-list', id: 't-import-conflicts' }, shown.map((c) => h('li', { text: c.type + (c.name ? ': ' + c.name : ' ' + JSON.parse(c.key)) +
            (c.note ? ', ' + c.note : '') }))));
        }
        if (p.mode === 'merge' && p.choosable > 0) {
          const radio = (value, label) => h('label', { class: 't-check' }, [h('input', { type: 'radio', name: 'import-choice', value: value,
            id: 't-choice-' + value, checked: view.choice === value, 'data-t-change': 'data-import-choice' }), label]);
          box.appendChild(h('fieldset', { class: 't-fieldset' }, [h('legend', { text: 'Records that differ' }),
            radio('keep', 'Keep what is on this device'),
            radio('file', p.choosable === 1 ? 'Use the file\'s version for this 1 record' : 'Use the file\'s version for these ' + num(p.choosable) + ' records')]));
        }
        if (preview.notes.length) box.appendChild(h('ul', { class: 't-list', id: 't-import-notes' }, preview.notes.map((t) => h('li', { text: t }))));
        box.appendChild(h('div', { class: 't-actions' }, [
          h('button', { type: 'button', class: 't-btn t-primary', id: 't-import-confirm', 'data-t-action': 'data-import-confirm',
            text: p.mode === 'empty' ? 'Import into this empty database' : 'Merge' }),
          h('button', { type: 'button', class: 't-btn', id: 't-import-cancel', 'data-t-action': 'data-import-cancel', text: 'Cancel' })]));
      }

      function clearFile() {
        const input = $('t-import-file');
        if (input) input.value = '';
      }

      ui.registerActions({
        async 'data-export'(el) {
          const kind = el.getAttribute('data-kind');
          const msg = $('t-export-msg');
          await learning.flush();
          const r = kind === 'json' ? await exporter.exportJson({ scope: 'all' }) : await exporter.exportCsv(kind);
          const d = r.ok ? exporter.download(r.name, r.text, r.mime) : r;
          const left = r.leftOut && r.leftOut.length ? ' Left out ' + num(r.leftOut.length) + ' records that belong to no student.' : '';
          if (msg) msg.textContent = d.ok ? 'Saved ' + r.name + '.' + left : d.message;
        },
        async 'data-import-file'(el) {
          view.plan = null;
          view.choice = 'keep';
          renderPlan();
          const file = el.files && el.files[0];
          if (!file) return;
          view.fileName = file.name;
          showResult('Checking ' + file.name + '...');
          await learning.flush();
          const r = await importer.read(file);
          const c = r.ok ? await importer.check(r.text) : r;
          if (!c.ok) { clearFile(); showResult(c.message, c.problems, true); return; }
          view.plan = c.plan;
          showResult('Nothing has changed yet. Check the summary, then confirm or cancel.');
          renderPlan();
        },
        'data-import-choice'(el) { view.choice = el.value === 'file' ? 'file' : 'keep'; renderPlan(); },
        'data-import-cancel'() {
          view.plan = null;
          renderPlan();
          clearFile();
          showResult('Import cancelled. Nothing was changed.');
        },
        async 'data-import-confirm'() {
          const p = view.plan;
          if (!p) return;
          await learning.flush();
          const res = await importer.apply(p, view.choice);
          if (!res.ok && res.changed) { view.plan = res.plan; view.choice = 'keep'; renderPlan(); showResult(res.message, null, true); return; }
          view.plan = null;
          clearFile();
          if (!res.ok) { renderPlan(); showResult(res.message, null, true); return; }
          await ui.open('data');
          showResult(res.message);
        }
      });
      ui.registerTab('data', { label: 'Data', nav: true, render: render });
      return { view };
    });
}());
