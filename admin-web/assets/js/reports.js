/**
 * Reports & export (W17).
 *
 * Preview then export, deliberately in that order: the export is streamed straight to a file
 * and an operator who exports blind discovers a wrong date range only after mailing it to
 * someone. The preview runs the same filters against the paginated list endpoint, so what is
 * on screen is what lands in the file.
 *
 * The export itself carries no personal data — see the endpoint. Saying so on the screen
 * matters as much as enforcing it: an operator who believes the file is complete will go
 * looking for a way to add Aadhaar to it.
 */

(function (MaitAI, $) {
  'use strict';

  const ui = MaitAI.ui;
  const PREVIEW_ROWS = 10;

  const STATUS_TONE = {
    completed: 'good',
    payment_pending: 'warn',
    photo_captured: 'info',
    straw_verified: 'info',
    draft: null,
    cancelled: 'bad',
  };

  function filters() {
    const params = {};
    const from = $('#date-from').val();
    const to = $('#date-to').val();
    const mpp = $('#filter-mpp').val();
    const status = $('#filter-status').val();
    const search = ($('#search').val() || '').trim();

    if (from) {
      params.date_from = from;
    }
    if (to) {
      params.date_to = to;
    }
    if (mpp) {
      params.mpp = mpp;
    }
    if (status) {
      params.status = status;
    }
    if (search) {
      params.search = search;
    }
    return params;
  }

  function row(event) {
    return (
      '<tr>' +
      '<td><a class="table__code" href="ai-event.html?id=' +
      event.id +
      '">' +
      event.id +
      '</a></td>' +
      '<td>' +
      ui.dateTime(event.created_at) +
      '</td>' +
      '<td>' +
      ui.identity(event.mpp_name, event.mpp_code) +
      '</td>' +
      '<td>' +
      ui.identity(event.mait_name, event.mait_code) +
      '</td>' +
      '<td class="table__num">' +
      (event.payment ? ui.money(event.payment.amount) : '—') +
      '</td>' +
      '<td>' +
      ui.pill(event.status_display, STATUS_TONE[event.status]) +
      '</td>' +
      '</tr>'
    );
  }

  function runQuery() {
    MaitAI.shell.clearAlert();
    const params = $.extend({ limit: PREVIEW_ROWS, offset: 0 }, filters());

    MaitAI.api
      .aiEvents(params)
      .done(function (page) {
        $('#preview-count').text(
          ui.number(page.count) +
            ' rows match · showing the first ' +
            Math.min(PREVIEW_ROWS, page.count)
        );
        ui.rows($('#rows'), page.results, row, 'Nothing matches those filters.', 6);
      })
      .fail(function (problem) {
        MaitAI.shell.alert(problem.detail);
      });
  }

  /**
   * Trigger the download.
   *
   * The endpoint streams and needs the bearer token, so this fetches it as a blob rather
   * than pointing the browser at the URL — a plain link would arrive unauthenticated and
   * bounce the operator to the login screen with no explanation.
   */
  function exportCsv() {
    MaitAI.shell.clearAlert();
    const query = $.param(filters());
    const token = MaitAI.api.tokens.get().access;

    $('#export').prop('disabled', true).text('Preparing…');

    fetch(MaitAI.api.baseUrl() + '/reports/export/' + (query ? '?' + query : ''), {
      headers: { Authorization: 'Bearer ' + token },
    })
      .then(function (response) {
        if (!response.ok) {
          throw new Error('export failed');
        }
        return response.blob();
      })
      .then(function (blob) {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'ai-events.csv';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
      })
      .catch(function () {
        MaitAI.shell.alert('The export could not be produced. Try a narrower date range.');
      })
      .finally(function () {
        $('#export').prop('disabled', false).text('Export CSV →');
      });
  }

  $(function () {
    if (!MaitAI.shell.requireSession()) {
      return;
    }
    MaitAI.shell.mount();

    MaitAI.api.mpps({ limit: 200 }).done(function (page) {
      $('#filter-mpp').append(
        (page.results || [])
          .map(function (mpp) {
            return (
              '<option value="' +
              ui.escapeHtml(mpp.mpp_code) +
              '">' +
              ui.escapeHtml(mpp.mpp_name) +
              '</option>'
            );
          })
          .join('')
      );
    });

    $('#query-form').on('submit', function (event) {
      event.preventDefault();
      runQuery();
    });

    $('#export').on('click', exportCsv);
  });
})(window.MaitAI, jQuery);
