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
    MaitAI.shell.clearAlert();
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

  function renderRunning(upload) {
    if (!upload) {
      $('#running').prop('hidden', true);
      return;
    }

    const percent = upload.progress_percent || 0;
    $('#running').prop('hidden', false);
    $('#running-title').text('Applying ' + upload.file_name + ' — do not close this tab');
    $('#running-percent').text(percent + '%');
    $('#running-bar').css('width', percent + '%');
    $('#running-meta').text(
      ui.number(upload.total_rows) + ' rows · started ' + ui.dateTime(upload.created_at)
    );

    $('#stage-uploaded').text('Received');
    $('#stage-read').text(ui.number(upload.processed_rows) + ' read');
    $('#stage-applied').text(ui.number(upload.success_rows) + ' applied');
    $('#stage-rejected').text(
      upload.failed_rows ? ui.number(upload.failed_rows) + ' rejected' : 'None so far'
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

  function poll(id) {
    window.clearTimeout(state.polling);
    state.polling = window.setTimeout(function () {
      MaitAI.api
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
            upload.failed_rows ? 'bad' : 'warn'
          );
          showRejects(upload.id, upload.failed_rows);
          load();
        })
        .fail(function () {
          // A dropped poll is not a failed import. Stop asking and reload the roster.
          renderRunning(null);
          load();
        });
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
      MaitAI.shell.alert(saved.name + ' saved · ' + saved.mpp_count + ' MPP(s) covered', 'warn');
      load();
    });
    load();

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

      MaitAI.api
        .uploadAssignments(file)
        .done(function (upload) {
          renderRunning(upload);
          poll(upload.id);
        })
        .fail(function (problem) {
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
