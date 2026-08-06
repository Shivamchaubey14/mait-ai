/**
 * SAP upload (W3).
 *
 * The Member master is 105,000+ rows and is parsed by a Celery worker, so the upload returns
 * as soon as the job is queued and the page polls for progress (SRS §6.1.6). Without a
 * visible, moving progress bar an operator closes the tab after two minutes and reports the
 * import as broken — while it is still running.
 *
 * A failed row never stops the import. Everything valid lands and the rejects go to a report
 * keyed by the spreadsheet's own row numbers, so the fix happens in SAP against the file the
 * operator has open (W4).
 */

(function (MaitAI, $) {
  'use strict';

  const ui = MaitAI.ui;
  const LIMIT = 15;
  const POLL_MS = 2000;

  const state = { offset: 0, polling: null };

  const TYPE_LABEL = { members: 'Member', maits: 'Mait', mpp: 'MPP' };

  const STATUS_TONE = {
    completed: 'good',
    completed_with_errors: 'warn',
    processing: 'info',
    queued: 'info',
    failed: 'bad',
  };

  function row(upload) {
    const failed = upload.failed_rows || 0;
    return (
      '<tr' +
      (upload.status === 'failed' ? ' class="is-blocked"' : failed ? ' class="is-waiting"' : '') +
      '>' +
      '<td><span class="table__name">' +
      ui.escapeHtml(upload.file_name) +
      '</span></td>' +
      '<td>' +
      ui.escapeHtml(TYPE_LABEL[upload.upload_type] || upload.upload_type_display) +
      '</td>' +
      '<td class="table__num">' +
      ui.number(upload.total_rows) +
      '</td>' +
      '<td class="table__num">' +
      (failed
        ? '<a href="upload-errors.html?id=' + upload.id + '">' + ui.number(failed) + '</a>'
        : '—') +
      '</td>' +
      '<td>' +
      ui.dateTime(upload.finished_at) +
      '</td>' +
      '<td>' +
      ui.pill(upload.status_display, STATUS_TONE[upload.status]) +
      '</td>' +
      '</tr>'
    );
  }

  function renderRunning(upload) {
    if (!upload) {
      $('#running').prop('hidden', true);
      return;
    }

    const percent = upload.progress_percent || 0;
    $('#running').prop('hidden', false);
    $('#running-title').text('Importing ' + upload.file_name + ' — do not close this tab');
    $('#running-percent').text(percent + '%');
    $('#running-bar').css('width', percent + '%');
    $('#running-meta').text(
      (TYPE_LABEL[upload.upload_type] || '') +
        ' · ' +
        ui.number(upload.total_rows) +
        ' rows · started ' +
        ui.dateTime(upload.created_at)
    );

    $('#stage-uploaded').text('Received');
    $('#stage-validated').text(ui.number(upload.processed_rows) + ' rows read');
    $('#stage-written').text(ui.number(upload.success_rows) + ' written');
    $('#stage-report').text(
      upload.failed_rows ? ui.number(upload.failed_rows) + ' rejected' : 'Available when done'
    );
  }

  function poll(id) {
    window.clearTimeout(state.polling);
    state.polling = window.setTimeout(function () {
      MaitAI.api
        .uploadStatus(id)
        .done(function (upload) {
          renderRunning(['queued', 'processing'].indexOf(upload.status) >= 0 ? upload : null);
          if (['queued', 'processing'].indexOf(upload.status) >= 0) {
            poll(id);
          } else {
            // Finished: the history table is now the truth about this file.
            load();
          }
        })
        .fail(function () {
          // A dropped poll is not a failed import. Stop asking and let the history show it.
          renderRunning(null);
          load();
        });
    }, POLL_MS);
  }

  function load() {
    MaitAI.api
      .uploadHistory({ limit: LIMIT, offset: state.offset })
      .done(function (page) {
        ui.rows($('#rows'), page.results, row, 'Nothing has been uploaded yet.', 6);
        ui.pager(
          $('#pager'),
          { count: page.count, limit: LIMIT, offset: state.offset },
          function (offset) {
            state.offset = offset;
            load();
          }
        );

        // "105,412 rows last time" tells the operator whether the file they are about to
        // send is the size they expect, before they send it.
        ['members', 'maits', 'mpp'].forEach(function (type) {
          const last = (page.results || []).filter(function (u) {
            return u.upload_type === type;
          })[0];
          $('[data-last="' + type + '"]').text(
            last
              ? 'Last: ' + ui.number(last.total_rows) + ' rows on ' + ui.date(last.finished_at)
              : 'Never uploaded'
          );
        });

        const running = (page.results || []).filter(function (u) {
          return ['queued', 'processing'].indexOf(u.status) >= 0;
        })[0];
        if (running) {
          renderRunning(running);
          poll(running.id);
        }
      })
      .fail(function (problem) {
        MaitAI.shell.alert(problem.detail);
        ui.rows($('#rows'), [], row, 'Could not load the upload history.', 6);
      });
  }

  $(function () {
    if (!MaitAI.shell.requireSession()) {
      return;
    }
    MaitAI.shell.mount();
    load();

    $('[data-upload]').on('change', function () {
      const type = $(this).data('upload');
      const file = this.files && this.files[0];
      if (!file) {
        return;
      }
      MaitAI.shell.clearAlert();

      MaitAI.api
        .uploadMaster(type, file, function (percent) {
          renderRunning({
            file_name: file.name,
            upload_type: type,
            progress_percent: percent,
            total_rows: 0,
            processed_rows: 0,
            success_rows: 0,
            failed_rows: 0,
            created_at: new Date().toISOString(),
          });
        })
        .done(function (upload) {
          renderRunning(upload);
          poll(upload.id);
          load();
        })
        .fail(function (problem) {
          renderRunning(null);
          MaitAI.shell.alert(MaitAI.api.problemToLines(problem).join(' · '));
        });

      // Cleared so re-choosing the same file fires a change event again — otherwise a retry
      // after a rejected upload silently does nothing.
      this.value = '';
    });

    $('#templates').on('click', function () {
      MaitAI.shell.alert(
        'Templates are the SAP exports themselves — upload the file SAP produces, unedited.',
        'warn'
      );
    });
  });
})(window.MaitAI, jQuery);
