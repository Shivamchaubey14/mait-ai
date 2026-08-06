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

  const state = { id: null, all: [], offset: 0, fileName: '' };

  function uploadId() {
    const match = /[?&]id=(\d+)/.exec(window.location.search);
    return match ? match[1] : null;
  }

  function row(entry) {
    return (
      '<tr class="is-blocked">' +
      '<td class="table__num">' +
      (entry.row === null || entry.row === undefined ? '—' : entry.row) +
      '</td>' +
      '<td class="error-row__problem">' +
      ui.escapeHtml(entry.error) +
      '</td>' +
      '</tr>'
    );
  }

  function renderPage() {
    const slice = state.all.slice(state.offset, state.offset + PAGE);
    ui.rows($('#rows'), slice, row, 'No rows were rejected.', 2);
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
    const lines = ['row,problem'].concat(
      state.all.map(function (entry) {
        return (
          (entry.row === null || entry.row === undefined ? '' : entry.row) +
          ',"' +
          String(entry.error).replace(/"/g, '""') +
          '"'
        );
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
        ui.rows($('#rows'), [], row, 'Could not load the report.', 2);
      });

    $('#download').on('click', downloadCsv);
  });
})(window.MaitAI, jQuery);
