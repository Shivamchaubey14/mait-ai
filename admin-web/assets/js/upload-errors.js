/**
 * Upload error report (W4).
 *
 * A rejected row is a row somebody has to go and fix in SAP, so the report is keyed by the
 * spreadsheet's own row number rather than by anything this system invented. The operator has
 * the file open next to the screen; any other identifier makes them hunt.
 *
 * The rows that passed are already live. Saying so is the difference between the operator
 * fixing four rows and re-uploading, and the operator assuming the whole import failed.
 */

(function (MaitAI, $) {
  'use strict';

  const ui = MaitAI.ui;
  const PAGE = 25;

  const state = { id: null, all: [], offset: 0, fileName: '', columns: [] };

  function uploadId() {
    const match = /[?&]id=(\d+)/.exec(window.location.search);
    return match ? match[1] : null;
  }

  /**
   * The identifying columns, between the row number and the problem.
   *
   * Written from the response rather than sitting in the HTML: a rejected Member row is
   * identified by a member code and an MPP, an assignment row by an MPP and a Mait, and this
   * is one screen for all four masters.
   */
  function renderHead() {
    const $head = $('#head');
    $head.find('[data-col]').remove();
    const cells = state.columns.map(function (label) {
      return '<th data-col scope="col">' + ui.escapeHtml(label) + '</th>';
    });
    if (cells.length) {
      $head.find('th').first().after(cells.join(''));
    }
  }

  function row(entry) {
    const fields = entry.fields || {};
    const cells = state.columns.map(function (label) {
      const value = fields[label];
      // An empty cell is left empty on purpose. "Member code is blank." beside a filled-in
      // name and a blank code column is the whole explanation, and a dash there would read as
      // "this column does not apply" rather than "this is what the row was missing".
      return value
        ? '<td>' + ui.escapeHtml(value) + '</td>'
        : '<td class="error-row__blank">' + (state.columns.length ? '(blank)' : '') + '</td>';
    });

    return (
      '<tr class="is-blocked">' +
      '<td class="table__num">' +
      (entry.row === null || entry.row === undefined ? '—' : entry.row) +
      '</td>' +
      cells.join('') +
      '<td class="error-row__problem">' +
      ui.escapeHtml(entry.error) +
      '</td>' +
      '</tr>'
    );
  }

  function renderPage() {
    const slice = state.all.slice(state.offset, state.offset + PAGE);
    ui.rows($('#rows'), slice, row, 'No rows were rejected.', state.columns.length + 2);
    ui.pager(
      $('#pager'),
      { count: state.all.length, limit: PAGE, offset: state.offset },
      function (offset) {
        state.offset = offset;
        renderPage();
      }
    );
  }

  /**
   * Build the CSV in the browser.
   *
   * The report is already in hand and bounded by the server, so a download endpoint would be
   * a round trip to re-send data this page is holding.
   */
  function downloadCsv() {
    const quote = function (value) {
      return (
        '"' + String(value === null || value === undefined ? '' : value).replace(/"/g, '""') + '"'
      );
    };

    // The same columns as the screen. A CSV that drops them would send the operator back to
    // the browser to work out which record each row number was.
    const header = ['row'].concat(state.columns, ['problem']).map(quote).join(',');
    const lines = [header].concat(
      state.all.map(function (entry) {
        const fields = entry.fields || {};
        return [entry.row]
          .concat(
            state.columns.map(function (label) {
              return fields[label] || '';
            }),
            [entry.error]
          )
          .map(quote)
          .join(',');
      })
    );
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = (state.fileName || 'upload') + '-errors.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  }

  $(function () {
    if (!MaitAI.shell.requireSession()) {
      return;
    }
    MaitAI.shell.mount();

    state.id = uploadId();
    if (!state.id) {
      MaitAI.shell.alert('No upload was named in the address.');
      return;
    }

    MaitAI.api
      .uploadErrors(state.id)
      .done(function (report) {
        state.all = report.results || [];
        state.fileName = report.file_name;
        // Reports written before the identifying cells were captured have none, and a set of
        // empty columns would say less than no columns at all.
        state.columns = (report.columns || []).filter(function (label) {
          return state.all.some(function (entry) {
            return entry.fields && Object.prototype.hasOwnProperty.call(entry.fields, label);
          });
        });
        renderHead();

        $('#title').text('Errors in ' + report.file_name);
        $('#meta').text(
          ui.number(report.failed_rows) +
            ' rows rejected' +
            (report.truncated
              ? ' · showing the first ' + ui.number(state.all.length) + ', the rest are in the file'
              : '')
        );

        // Said plainly rather than left for the operator to infer from two numbers.
        if (report.truncated) {
          MaitAI.shell.alert(
            'Only the first ' +
              ui.number(state.all.length) +
              ' rejections are stored. Fix these, re-upload, and the next report shows what is left.',
            'warn'
          );
        }

        renderPage();
      })
      .fail(function (problem) {
        MaitAI.shell.alert(problem.status === 404 ? 'No such upload.' : problem.detail);
        ui.rows($('#rows'), [], row, 'Could not load the report.', state.columns.length + 2);
      });

    $('#download').on('click', downloadCsv);
  });
})(window.MaitAI, jQuery);
