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

  /**
   * The three cards, each pairing the URL a file is posted to with the type the history
   * reports back. They are not the same word — `POST /uploads/maits/` stores `mait` — and
   * treating them as one is why every card but MPP read "Never uploaded" after a good import.
   */
  const MASTERS = [
    { endpoint: 'members', type: 'member' },
    { endpoint: 'maits', type: 'mait' },
    { endpoint: 'mpp', type: 'mpp' },
  ];

  const STORED_TYPE = MASTERS.reduce(function (map, master) {
    map[master.endpoint] = master.type;
    return map;
  }, {});

  /* Keyed by what the API stores, not by what the endpoint is called. */
  const TYPE_LABEL = { member: 'Member', mait: 'Mait', mpp: 'MPP' };

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
            // Finished: the history table and the card are now the truth about this file.
            load();
            loadCards();
          }
        })
        .fail(function () {
          // A dropped poll is not a failed import. Stop asking and let the history show it.
          renderRunning(null);
          load();
          loadCards();
        });
    }, POLL_MS);
  }

  /**
   * The one-line summary under each card's title.
   *
   * "105,412 rows last time" tells the operator whether the file they are about to send is the
   * size they expect, before they send it. Asked per type rather than picked out of the history
   * page: a card must not claim a master was never uploaded because fifteen newer uploads of
   * another type pushed it onto page two.
   */
  function loadCards() {
    MASTERS.forEach(function (master) {
      const $meta = $('[data-last="' + master.type + '"]');
      MaitAI.api
        .uploadHistory({ upload_type: master.type, limit: 1 })
        .done(function (page) {
          const last = (page.results || [])[0];
          if (!last) {
            $meta.text('Never uploaded');
          } else if (last.status === 'failed') {
            $meta.text('Last attempt failed on ' + ui.dateTime(last.created_at));
          } else if (!last.finished_at) {
            $meta.text('Importing now — ' + ui.number(last.processed_rows) + ' rows read');
          } else {
            $meta.text(
              'Last: ' + ui.number(last.total_rows) + ' rows on ' + ui.date(last.finished_at)
            );
          }
        })
        .fail(function () {
          $meta.text('—');
        });
    });
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
    loadCards();

    $('[data-upload]').on('change', function () {
      const endpoint = $(this).data('upload');
      const file = this.files && this.files[0];
      if (!file) {
        return;
      }
      MaitAI.shell.clearAlert();

      MaitAI.api
        .uploadMaster(endpoint, file, function (percent) {
          renderRunning({
            file_name: file.name,
            upload_type: STORED_TYPE[endpoint],
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
          loadCards();
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
