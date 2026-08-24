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

  /**
   * A worked example, for a database that has nothing to show yet.
   *
   * Six empty columns and "Run a query to preview it" says nothing about what an operator is
   * about to get, and on a fresh install — where no AI event exists — running the query says
   * the same nothing. So the table falls back to a filled-in shape of the answer.
   *
   * It used to be what the screen *opened* on, before any query ran, which stopped making
   * sense the moment there were real events to show: an operator arriving at Reports was met
   * by five invented rows about villages that do not exist, and had to press a button to find
   * out what was actually in the system. The screen runs the query itself now, and this is
   * only reached when the answer is genuinely empty and nothing has been filtered — because
   * "no rows match these filters" is a result, and covering it with an example would read as
   * the result.
   *
   * It is unmistakably not data: the head carries a Sample badge, the rows are greyed, the
   * event codes are not links. Nothing here is ever exported — the download is streamed from
   * the API, which has never heard of these.
   */
  const SAMPLE = [
    {
      code: 'AI-100482',
      when: '12 Aug 2026, 08:14',
      mpp: ['BARWALA', 'MPP000412'],
      mait: ['SUNITA DEVI', '5500000054'],
      amount: '₹ 300',
      status: ['Completed', 'good'],
    },
    {
      code: 'AI-100481',
      when: '12 Aug 2026, 07:52',
      mpp: ['KHERI JAT', 'MPP000188'],
      mait: ['RAMESH KUMAR', '5500000091'],
      amount: '₹ 300',
      status: ['Completed', 'good'],
    },
    {
      code: 'AI-100479',
      when: '11 Aug 2026, 17:30',
      mpp: ['BARWALA', 'MPP000412'],
      mait: ['SUNITA DEVI', '5500000054'],
      amount: '₹ 300',
      status: ['Payment pending', 'warn'],
    },
    {
      code: 'AI-100476',
      when: '11 Aug 2026, 16:05',
      mpp: ['DHANANA', 'MPP000233'],
      mait: ['ANIL SINGH', '5500000117'],
      amount: '—',
      status: ['Straw verified', 'info'],
    },
    {
      code: 'AI-100470',
      when: '11 Aug 2026, 09:41',
      mpp: ['KHERI JAT', 'MPP000188'],
      mait: ['RAMESH KUMAR', '5500000091'],
      amount: '—',
      status: ['Cancelled', 'bad'],
    },
  ];

  function sampleRow(item) {
    return (
      '<tr>' +
      '<td><span class="table__code">' +
      ui.escapeHtml(item.code) +
      '</span></td>' +
      '<td>' +
      ui.escapeHtml(item.when) +
      '</td>' +
      '<td>' +
      ui.identity(item.mpp[0], item.mpp[1]) +
      '</td>' +
      '<td>' +
      ui.identity(item.mait[0], item.mait[1]) +
      '</td>' +
      '<td class="table__num">' +
      ui.escapeHtml(item.amount) +
      '</td>' +
      '<td>' +
      ui.pill(item.status[0], item.status[1]) +
      '</td>' +
      '</tr>'
    );
  }

  function showSample() {
    $('#preview').addClass('preview--sample');
    $('#preview-count').html(
      '<span class="preview__badge">Sample — run a query for real rows</span>'
    );
    $('#rows').html(SAMPLE.map(sampleRow).join(''));
  }

  function runQuery() {
    MaitAI.shell.clearAlert();
    const chosen = filters();
    const filtered = Object.keys(chosen).length > 0;
    const params = $.extend({ limit: PREVIEW_ROWS, offset: 0 }, chosen);

    MaitAI.api
      .aiEvents(params)
      .done(function (page) {
        // An empty answer to a *filtered* query is a real answer and says so. An empty answer
        // to no filters at all means the database has nothing yet, which is the one case the
        // worked example is for.
        if (!page.count && !filtered) {
          showSample();
          return;
        }

        // Off for good the moment a real answer arrives, even an empty one — "no rows match"
        // is a result, and leaving the example under it would read as the result.
        $('#preview').removeClass('preview--sample');
        $('#preview-count').text(
          ui.number(page.count) +
            ' rows match · showing the first ' +
            Math.min(PREVIEW_ROWS, page.count)
        );
        ui.rows($('#rows'), page.results, row, 'Nothing matches those filters.', 6);
      })
      .fail(function (problem) {
        MaitAI.shell.alert(problem.detail);
        // The example is not a stand-in for a failed request — that would present invented
        // rows as though the query had answered.
        ui.rows($('#rows'), [], row, 'Could not load the preview.', 6);
      });
  }

  /**
   * Trigger the download.
   *
   * The fetch-as-blob dance lives in `api.download` — it needs the bearer token, and two
   * screens now export. What stays here is the wording of the failure, which is this
   * screen's alone: a narrower date range is the fix for an AI event export and not
   * necessarily for anything else.
   */
  function exportCsv() {
    MaitAI.shell.clearAlert();
    const query = $.param(filters());

    $('#export').prop('disabled', true);
    $('#export-label').text('Preparing…');

    MaitAI.api
      .download('/reports/export/' + (query ? '?' + query : ''), 'ai-events.csv')
      .catch(function () {
        MaitAI.shell.alert('The export could not be produced. Try a narrower date range.');
      })
      .finally(function () {
        $('#export').prop('disabled', false);
        $('#export-label').text('Export CSV');
      });
  }

  $(function () {
    if (!MaitAI.shell.requireSession()) {
      return;
    }
    MaitAI.shell.mount();
    // Live on open. The screen is "build a query, preview it, export it", and the unfiltered
    // query is the honest starting point of that — the most recent events, which is what an
    // operator is checking against before they narrow anything.
    runQuery();

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
