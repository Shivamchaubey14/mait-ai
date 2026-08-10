/**
 * Mait ↔ MPP assignment (W19).
 *
 * An MPP is the village collection point where members pour their milk — the area marker a
 * Mait works. The assignment is what scopes their whole app: they see the members of the MPPs
 * they cover and can record an AI event only for those (SRS §6.2.2–6.2.3). So this screen
 * moves farmers and permissions around, not just labels, and it says so.
 *
 * Two ways in, because the two jobs are different sizes. A reassignment season is hundreds of
 * rows and belongs in Excel — hence the round trip, handed out already filled so nobody
 * retypes the three thousand rows they are not changing. A phone call about one Sahayak's
 * number is one row, and downloading a workbook to fix it is how mistakes get made.
 *
 * The upload runs on the same pipeline as the SAP masters: queued, polled, partial success,
 * row-level errors (SRS §6.1.4, §6.1.6).
 */

(function (MaitAI, $) {
  'use strict';

  const ui = MaitAI.ui;
  const LIMIT = 25;
  const POLL_MS = 1500;

  const state = {
    offset: 0,
    rows: [],
    editing: null,
    polling: null,
    // The follower's timer, and whether a POST is still open. Separate from `polling`: one
    // follows the newest row by type, the other polls one row by id once its id is known.
    watching: null,
    sending: false,
    // High-water mark for the bar, so it only ever grows within one import.
    shown: 0,
    uncoveredOnly: false,
    noMobileOnly: false,
  };

  /* --- roster ----------------------------------------------------------------------------- */

  /** Coverage as chips, capped: a Mait with forty MPPs would push the row off the screen. */
  function coverageCell(mait) {
    const codes = mait.mpp_codes || [];
    if (!codes.length) {
      return '<span class="table__sub">No MPPs — this Mait can record nothing</span>';
    }
    const shown = codes.slice(0, 6);
    return (
      '<div class="codes">' +
      shown
        .map(function (code) {
          return '<span class="code-chip">' + ui.escapeHtml(code) + '</span>';
        })
        .join('') +
      (codes.length > shown.length
        ? '<span class="code-chip code-chip--more">+' + (codes.length - shown.length) + '</span>'
        : '') +
      '</div>'
    );
  }

  function stateCell(mait) {
    if (!mait.mobile_no) {
      // The number is the only way in. Without one they cannot be activated at all.
      return ui.pill('No mobile', 'bad');
    }
    return mait.activated ? ui.pill('Active', 'good') : ui.pill('Not activated', 'warn');
  }

  function row(mait) {
    return (
      '<tr' +
      (mait.mpp_codes && mait.mpp_codes.length ? '' : ' class="is-waiting"') +
      '>' +
      '<td>' +
      ui.identity(mait.name, mait.sahayak_vendor_code) +
      '</td>' +
      '<td>' +
      (mait.mobile_no ? ui.escapeHtml(mait.mobile_no) : '<span class="table__sub">—</span>') +
      '</td>' +
      '<td>' +
      coverageCell(mait) +
      '</td>' +
      '<td>' +
      stateCell(mait) +
      '</td>' +
      '<td><button class="btn" type="button" data-edit="' +
      ui.escapeHtml(mait.sahayak_vendor_code) +
      '">Edit</button></td>' +
      '</tr>'
    );
  }

  function query() {
    const params = { limit: LIMIT, offset: state.offset };
    const search = ($('#search').val() || '').trim();
    if (search) {
      params.search = search;
    }
    if (state.noMobileOnly) {
      params.needs_mobile = 'true';
    }
    return params;
  }

  function load() {
    // Does not clear the alert region. It used to, and every message the screen produced was
    // wiped by the reload that followed it — "3,134 rows applied" was written and then removed
    // a few milliseconds later by this very function. Alerts are cleared where a new action
    // starts instead.
    MaitAI.api
      .maitRoster(query())
      .done(function (page) {
        // Coverage is not a server-side filter, so it narrows what arrived. The count says
        // which it is, rather than letting a filtered page read as the whole roster.
        const all = page.results || [];
        state.rows = state.uncoveredOnly
          ? all.filter(function (mait) {
              return !(mait.mpp_codes || []).length;
            })
          : all;

        const summary = page.summary || {};
        $('#roster-count').text(
          ui.number(summary.total || page.count || 0) +
            ' Maits · ' +
            ui.number(summary.without_mobile || 0) +
            ' with no mobile'
        );

        ui.rows($('#rows'), state.rows, row, 'No Mait matches those filters.', 5);
        ui.pager(
          $('#pager'),
          { count: page.count, limit: LIMIT, offset: state.offset },
          function (offset) {
            state.offset = offset;
            load();
          }
        );
      })
      .fail(function (problem) {
        MaitAI.shell.alert(problem.detail);
        ui.rows($('#rows'), [], row, 'Could not load the roster.', 5);
      });
  }

  /* --- editing one row ---------------------------------------------------------------------
   * The editor itself is shared with the Maits screen — see assets/js/mait-editor.js. Two
   * screens correcting the same record should not be two different forms.
   */

  /* --- the round trip --------------------------------------------------------------------- */

  /**
   * Write one stage tile and colour it by where the import has got to — blue while it is inside
   * that stage, green once it is past it. Same card as the SAP upload screen, deliberately:
   * this is the same pipeline, and nobody should have to open that screen to watch this file.
   */
  function stage(id, value, tone) {
    $(id)
      .text(value)
      .closest('.stage')
      .removeClass('is-live is-done')
      .addClass(tone || '');
  }

  function renderRunning(upload) {
    if (!upload) {
      $('#running').prop('hidden', true);
      state.shown = 0;
      return;
    }

    const total = upload.total_rows || 0;
    const processed = upload.processed_rows || 0;
    const reading = !total || processed < total;
    // Sending is not importing. The transfer finishes in one event on a file this size, and
    // putting its percentage on this bar ran the fill to the far end and then dropped it back
    // to whatever the import had actually reached.
    const sendingFile = Boolean(upload.sending);

    // Never backwards. The follower and the id poll can answer out of order, and a bar that
    // retreats reads as work being undone.
    const percent = sendingFile ? 0 : Math.max(state.shown, upload.progress_percent || 0);
    state.shown = percent;

    $('#running').prop('hidden', false);
    $('#running-title').text(
      (sendingFile ? 'Sending ' : 'Applying ') + upload.file_name + ' — do not close this tab'
    );
    $('#running-percent').text(sendingFile ? 'Sending…' : percent + '%');
    // #running-bar is the fill itself; the indeterminate class belongs on the track around it.
    // Clearing the inline width lets the stylesheet's stripe width take over while sending.
    const $fill = $('#running-bar');
    $fill.closest('.bar').toggleClass('is-indeterminate', sendingFile);
    $fill.css('width', sendingFile ? '' : percent + '%');
    $('#running-meta').text(
      (sendingFile
        ? ui.number(upload.progress_percent || 0) + '% of the file sent'
        : total
          ? ui.number(total) + ' rows'
          : 'counting rows') +
        ' · started ' +
        ui.dateTime(upload.created_at)
    );

    stage('#stage-uploaded', 'Received', 'is-done');
    stage(
      '#stage-read',
      ui.number(processed) + (total ? ' of ' + ui.number(total) : ' rows'),
      reading ? 'is-live' : 'is-done'
    );
    stage('#stage-applied', ui.number(upload.success_rows) + ' applied', reading ? '' : 'is-live');
    stage(
      '#stage-rejected',
      upload.failed_rows ? ui.number(upload.failed_rows) + ' rejected' : 'None so far',
      upload.failed_rows ? 'is-live' : ''
    );
  }

  function showRejects(uploadId, failed) {
    if (!failed) {
      $('#rejects').prop('hidden', true);
      return;
    }
    MaitAI.api.uploadErrors(uploadId).done(function (report) {
      $('#rejects').prop('hidden', false);
      $('#rejects-count').text(ui.number(report.failed_rows) + ' rejected');
      $('#rejects-body').html(
        (report.results || [])
          .map(function (item) {
            return (
              '<div class="reject">' +
              '<span class="reject__row">Row ' +
              (item.row === null || item.row === undefined ? '—' : item.row) +
              '</span>' +
              '<span class="reject__why">' +
              ui.escapeHtml(item.error) +
              '</span>' +
              '</div>'
            );
          })
          .join('') +
          (report.truncated
            ? '<div class="reject"><span class="reject__row"></span>' +
              '<span class="reject__why">Only the first few thousand are listed.</span></div>'
            : '')
      );
      $('#rejects')[0].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  /**
   * Follow the newest assignment import without knowing its id.
   *
   * Two jobs, one mechanism. It picks up an import that was already running when the page
   * loaded — a sheet takes a while and tabs get reloaded, and without this the card only ever
   * existed in the session that started the upload, leaving the SAP upload screen as the only
   * place to watch it. And it follows an import that is running *right now* inside the POST
   * this page is still waiting on: with CELERY_TASK_ALWAYS_EAGER the response is the last thing
   * to arrive, so the id it carries is useless for watching, while the row it describes has
   * been counting rows since the request was accepted.
   *
   * Keeps asking while `state.sending` is true even if nothing is running yet, because the row
   * appears a moment after the file does.
   */
  function followLatest() {
    window.clearTimeout(state.watching);
    return MaitAI.api
      .uploadHistory({ upload_type: 'assignment', limit: 1 })
      .done(function (page) {
        const latest = (page.results || [])[0];
        const running = latest && ['queued', 'processing'].indexOf(latest.status) >= 0;
        if (running) {
          renderRunning(latest);
        }
        if (running || state.sending) {
          state.watching = window.setTimeout(followLatest, POLL_MS);
        }
      })
      .fail(function () {
        // Nothing to say: the roster still loads, and the response will settle the card.
      });
  }

  /**
   * Ask once, now, and decide what to do with the answer.
   *
   * Called straight after the POST as well as on every tick. The POST answers 202 with the row
   * as it was created — queued, no rows counted — so rendering that and then waiting a whole
   * interval before asking means a quick file shows 0% for a second and a half and then simply
   * disappears. Which is what it does with CELERY_TASK_ALWAYS_EAGER set, as dev has it: the
   * import is already over by the time the response arrives.
   */
  function check(id) {
    return MaitAI.api
      .uploadStatus(id)
      .done(function (upload) {
        const running = ['queued', 'processing'].indexOf(upload.status) >= 0;
        renderRunning(running ? upload : null);
        if (running) {
          poll(id);
          return;
        }
        // Finished. Say what happened in one line, then show the rows that did not land.
        MaitAI.shell.alert(
          ui.number(upload.success_rows) +
            ' of ' +
            ui.number(upload.total_rows) +
            ' rows applied' +
            (upload.failed_rows ? ' · ' + ui.number(upload.failed_rows) + ' rejected' : ''),
          upload.failed_rows ? 'bad' : 'good'
        );
        showRejects(upload.id, upload.failed_rows);
        load();
      })
      .fail(function () {
        // A dropped poll is not a failed import. Stop asking and reload the roster.
        renderRunning(null);
        load();
      });
  }

  function poll(id) {
    window.clearTimeout(state.polling);
    state.polling = window.setTimeout(function () {
      check(id);
    }, POLL_MS);
  }

  function download() {
    // Streams with the bearer token, so it cannot be a plain link.
    const token = MaitAI.api.tokens.get().access;
    $('#download').prop('disabled', true).text('Preparing…');

    fetch(MaitAI.api.baseUrl() + '/admin/uploads/assignment-template/', {
      headers: { Authorization: 'Bearer ' + token },
    })
      .then(function (response) {
        if (!response.ok) {
          throw new Error('download failed');
        }
        return response.blob();
      })
      .then(function (blob) {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'mait-mpp-assignments.xlsx';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      })
      .catch(function () {
        MaitAI.shell.alert('Could not prepare the sheet. Try again in a moment.');
      })
      .then(function () {
        $('#download').prop('disabled', false).text('Download .xlsx');
      });
  }

  $(function () {
    if (!MaitAI.shell.requireSession()) {
      return;
    }
    MaitAI.shell.mount();
    MaitAI.maitEditor.mount('#mait-editor', function (saved) {
      MaitAI.shell.alert(saved.name + ' saved · ' + saved.mpp_count + ' MPP(s) covered', 'good');
      load();
    });
    load();
    followLatest();

    $('#download').on('click', download);

    $('#upload').on('click', function () {
      $('#file').trigger('click');
    });

    $('#file').on('change', function () {
      const file = this.files && this.files[0];
      if (!file) {
        return;
      }
      MaitAI.shell.clearAlert();
      $('#rejects').prop('hidden', true);

      /**
       * Paint the card now, before the request has left, and repaint it as the file goes up.
       *
       * Painting only from the transfer callback was why this screen appeared to have no card
       * at all: a workbook of a few hundred kilobytes finishes sending in a single event, and
       * with the import running inside the web process (CELERY_TASK_ALWAYS_EAGER) the response
       * does not come back until every row has been applied. So the one paint happened in the
       * first instant and the next thing to happen was the card being hidden as finished —
       * leaving the whole import with nothing on screen.
       */
      const startedAt = new Date().toISOString();
      const sending = function (percent) {
        renderRunning({
          file_name: file.name,
          sending: true,
          progress_percent: percent || 0,
          total_rows: 0,
          processed_rows: 0,
          success_rows: 0,
          failed_rows: 0,
          created_at: startedAt,
        });
      };
      state.shown = 0;
      sending(0);
      state.sending = true;
      followLatest();

      MaitAI.api
        .uploadAssignments(file, sending)
        .done(function (upload) {
          // The response is authoritative and carries the id, so the follower stands down.
          state.sending = false;
          window.clearTimeout(state.watching);
          check(upload.id);
        })
        .fail(function (problem) {
          state.sending = false;
          window.clearTimeout(state.watching);
          renderRunning(null);
          MaitAI.shell.alert(MaitAI.api.problemToLines(problem).join(' · '));
        });

      // Cleared so choosing the same file twice still fires a change.
      $(this).val('');
    });

    $('#rejects-close').on('click', function () {
      $('#rejects').prop('hidden', true);
    });

    let debounce = null;
    $('#search').on('input', function () {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(function () {
        state.offset = 0;
        MaitAI.shell.clearAlert();
        MaitAI.maitEditor.close();
        load();
      }, 350);
    });

    $('#filter-uncovered').on('click', function () {
      state.uncoveredOnly = !state.uncoveredOnly;
      $(this)
        .toggleClass('is-active', state.uncoveredOnly)
        .attr('aria-pressed', String(state.uncoveredOnly));
      load();
    });

    $('#filter-nomobile').on('click', function () {
      state.noMobileOnly = !state.noMobileOnly;
      state.offset = 0;
      $(this)
        .toggleClass('is-active', state.noMobileOnly)
        .attr('aria-pressed', String(state.noMobileOnly));
      load();
    });

    // Delegated: the table is rebuilt on every load and pager click.
    $('#rows').on('click', '[data-edit]', function () {
      MaitAI.shell.clearAlert();
      const code = String($(this).data('edit'));
      MaitAI.maitEditor.open(
        state.rows.filter(function (row_) {
          return row_.sahayak_vendor_code === code;
        })[0]
      );
    });
  });
})(window.MaitAI, jQuery);
