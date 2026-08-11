/**
 * AI events list (W5).
 *
 * The one table that answers "what happened in the field today". Every row is one
 * insemination, so the columns are chosen to be triaged without opening anything: who it was
 * for, who did it, whether the money landed, and what state it is in.
 *
 * Search is debounced rather than fired per keystroke — the table behind it is 31,000 rows
 * and this runs on back-office connections.
 */

(function (MaitAI, $) {
  'use strict';

  const ui = MaitAI.ui;
  const LIMIT = 25;

  const state = { offset: 0, count: 0 };

  /**
   * Status colours match the app exactly.
   *
   * A Mait and an admin looking at the same event must see the same colour, because field
   * users learn colour faster than they learn labels (tokens.css).
   */
  const STATUS_TONE = {
    completed: 'good',
    payment_pending: 'warn',
    photo_captured: 'info',
    straw_verified: 'info',
    draft: null,
    cancelled: 'bad',
  };

  function paymentCell(payment) {
    if (!payment) {
      // Normal, not missing: the event has not reached step 6 yet.
      return '<span class="table__sub">Not yet taken</span>';
    }
    const label = ui.money(payment.amount) + ' ' + (payment.mode || '').toLowerCase();
    if (payment.status === 'failed') {
      return label + '<span class="table__sub">Failed</span>';
    }
    if (!payment.is_verified) {
      return label + '<span class="table__sub">Awaiting confirmation</span>';
    }
    return label;
  }

  function animalCell(event) {
    const type = event.animal_type === 'BUFF' ? 'Buffalo' : 'Cow';
    return type + ' · ' + ui.escapeHtml(event.breed || '—');
  }

  function row(event) {
    // Anything waiting on a human is tinted, so a screenful can be triaged without reading
    // every status cell.
    const rowClass =
      event.status === 'payment_pending'
        ? ' class="is-waiting"'
        : event.status === 'cancelled'
          ? ' class="is-blocked"'
          : '';

    return (
      '<tr' +
      rowClass +
      '>' +
      '<td><a class="table__code" href="ai-event.html?id=' +
      event.id +
      '">' +
      event.id +
      '</a></td>' +
      '<td>' +
      ui.identity(event.owner_name, event.owner_type === 'member' ? event.mpp_code : 'Non-member') +
      '</td>' +
      '<td>' +
      ui.identity(event.mait_name, event.mait_code) +
      '</td>' +
      '<td>' +
      animalCell(event) +
      '</td>' +
      '<td>' +
      paymentCell(event.payment) +
      '</td>' +
      '<td>' +
      ui.dateTime(event.created_at) +
      '</td>' +
      '<td>' +
      ui.pill(event.status_display, STATUS_TONE[event.status]) +
      '</td>' +
      '</tr>'
    );
  }

  /**
   * A worked example, shown only when there is genuinely nothing and nothing is filtered.
   *
   * Seven empty columns describe nothing. On a fresh install — which this screen has to survive,
   * because no AI event can complete until payments land — "No events match these filters" is
   * both true and useless, so the table shows what a day's work looks like instead.
   *
   * Unmistakably not data: the head says Sample, the rows are greyed, and the event codes are
   * not links. The moment one real row exists it replaces the lot, and it never appears while a
   * filter is set, because there "nothing matches" is the answer.
   */
  const SAMPLE = [
    [
      'AI-100482',
      'KAVITA DEVI',
      'MPP000412',
      'SUNITA DEVI',
      '5500000054',
      'Cow · GIR',
      '₹ 300 upi',
      '12 Aug 2026, 08:14',
      'Completed',
      'good',
      '',
    ],
    [
      'AI-100481',
      'RADHA SINGH',
      'MPP000188',
      'RAMESH KUMAR',
      '5500000091',
      'Buffalo · MURRAH',
      '₹ 300 cash',
      '12 Aug 2026, 07:52',
      'Completed',
      'good',
      '',
    ],
    [
      'AI-100479',
      'MEENA KUMARI',
      'MPP000412',
      'SUNITA DEVI',
      '5500000054',
      'Cow · HF CROSS',
      '₹ 300 upi',
      '11 Aug 2026, 17:30',
      'Payment pending',
      'warn',
      ' class="is-waiting"',
    ],
    [
      'AI-100476',
      'SHANTI DEVI',
      'Non-member',
      'ANIL SINGH',
      '5500000117',
      'Cow · GIR',
      'Not yet taken',
      '11 Aug 2026, 16:05',
      'Straw verified',
      'info',
      '',
    ],
    [
      'AI-100470',
      'PUSHPA DEVI',
      'MPP000188',
      'RAMESH KUMAR',
      '5500000091',
      'Buffalo · MURRAH',
      'Not yet taken',
      '11 Aug 2026, 09:41',
      'Cancelled',
      'bad',
      ' class="is-blocked"',
    ],
  ];

  function sampleRow(r) {
    const money =
      r[6].indexOf('Not yet') === 0 ? '<span class="table__sub">' + r[6] + '</span>' : r[6];
    return (
      '<tr' +
      r[10] +
      '>' +
      '<td><span class="table__code">' +
      ui.escapeHtml(r[0]) +
      '</span></td>' +
      '<td>' +
      ui.identity(r[1], r[2]) +
      '</td>' +
      '<td>' +
      ui.identity(r[3], r[4]) +
      '</td>' +
      '<td>' +
      ui.escapeHtml(r[5]) +
      '</td>' +
      '<td>' +
      money +
      '</td>' +
      '<td>' +
      ui.escapeHtml(r[7]) +
      '</td>' +
      '<td>' +
      ui.pill(r[8], r[9]) +
      '</td>' +
      '</tr>'
    );
  }

  /** True when nothing is narrowing the list, so "nothing here" means nothing exists. */
  function unfiltered() {
    return (
      !($('#search').val() || '').trim() &&
      !$('#filter-status').val() &&
      !$('#filter-mpp').val() &&
      !$('#filter-from').val() &&
      !$('#filter-to').val()
    );
  }

  function showSample() {
    $('#events').addClass('events--sample');
    $('#events-note').html('<span class="events__badge">Sample — no events recorded yet</span>');
    $('#rows').html(SAMPLE.map(sampleRow).join(''));
  }

  function query() {
    const params = { limit: LIMIT, offset: state.offset };
    const status = $('#filter-status').val();
    const mpp = $('#filter-mpp').val();
    const from = $('#filter-from').val();
    const to = $('#filter-to').val();
    const search = ($('#search').val() || '').trim();

    if (search) {
      params.search = search;
    }
    if (status) {
      params.status = status;
    }
    if (mpp) {
      params.mpp = mpp;
    }
    if (from) {
      params.date_from = from;
    }
    if (to) {
      params.date_to = to;
    }
    return params;
  }

  function load() {
    MaitAI.shell.clearAlert();
    MaitAI.api
      .aiEvents(query())
      .done(function (page) {
        state.count = page.count;
        $('#event-count').text(ui.number(page.count) + ' events');

        // An empty unfiltered list is a screen nobody can read. Anything else — including a
        // filter that matches nothing — is a result, and gets said plainly.
        if (!page.count && unfiltered()) {
          showSample();
          $('#pager').empty();
          return;
        }

        $('#events').removeClass('events--sample');
        $('#events-note').text(
          ui.number(page.count) + ' matching · showing ' + (page.results || []).length
        );
        ui.rows($('#rows'), page.results, row, 'No events match these filters.', 7);
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
        ui.rows($('#rows'), [], row, 'Could not load events.', 7);
      });
  }

  function loadMppOptions() {
    MaitAI.api.mpps({ limit: 200 }).done(function (page) {
      const options = (page.results || []).map(function (mpp) {
        return (
          '<option value="' +
          ui.escapeHtml(mpp.mpp_code) +
          '">' +
          ui.escapeHtml(mpp.mpp_name) +
          '</option>'
        );
      });
      $('#filter-mpp').append(options.join(''));
    });
  }

  $(function () {
    if (!MaitAI.shell.requireSession()) {
      return;
    }
    MaitAI.shell.mount();
    loadMppOptions();

    // Arrived from a queue card on Exceptions or the dashboard. Set the control rather than
    // filtering behind its back: the operator has to be able to see why this list is short,
    // and to widen it without going back the way they came. An unknown value leaves the select
    // alone, so a mistyped URL shows everything rather than nothing.
    const status = MaitAI.shell.param('status');
    if (status) {
      $('#filter-status').val(status);
    }

    load();

    $('#filter-status, #filter-mpp, #filter-from, #filter-to').on('change', function () {
      state.offset = 0;
      load();
    });

    // Server-side search across 31,000 events is not free, and neither is a rural office
    // connection. Wait until the operator stops typing.
    let debounce = null;
    $('#search').on('input', function () {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(function () {
        state.offset = 0;
        load();
      }, 350);
    });

    $('#export').on('click', function () {
      MaitAI.shell.alert('CSV export arrives with the reports screen.', 'warn');
    });
  });
})(window.MaitAI, jQuery);
