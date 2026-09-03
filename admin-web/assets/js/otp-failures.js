/**
 * Failed OTPs (W16 detail).
 *
 * The Exceptions card can only say `981234••••  3 failure(s) today`, which tells an admin
 * somebody is stuck and nothing else — not who, not what they were trying to do, and not
 * which of four quite different things went wrong. Its Open link used to land on the roster
 * of Maits who had never activated, on the reasoning that a Mait failing an OTP is usually
 * one who never got in. Often true; useless when it is not, and a farmer failing a payment
 * OTP is not on that roster at all.
 *
 * So this screen answers the four questions in order: who, what for, what happened, and what
 * it is holding up. Each row opens in place rather than into a dialog — an operator works
 * down a queue, and a modal that has to be dismissed between rows turns seven decisions into
 * fourteen clicks.
 */

(function (MaitAI, $) {
  'use strict';

  const ui = MaitAI.ui;
  const shell = MaitAI.shell;

  /**
   * The tone each outcome is drawn in, and whether it is a fault at all.
   *
   * `superseded` is deliberately green. It is what happens to a code when somebody asks for
   * another one, so it is not a failure — and it is the single most common row on the screen
   * once the unattempted ones are shown, which is exactly why it must not look like one.
   */
  const OUTCOME = {
    attempts_exhausted: { tone: 'bad', advice: 'bad' },
    never_attempted: { tone: 'warn', advice: 'warn' },
    expired: { tone: null, advice: 'info' },
    superseded: { tone: 'good', advice: 'good' },
    open: { tone: 'info', advice: 'info' },
  };

  /**
   * The two outcomes that only exist among codes nobody typed into.
   *
   * The queue excludes those by default because the Exceptions card excludes them, and a
   * screen reached from a card saying "2" should not open on sixty-six rows. Picking either
   * chip widens the request — which is what somebody asking for "never entered" meant.
   */
  const NEEDS_UNATTEMPTED = ['never_attempted', 'superseded'];

  const state = { rows: [], outcome: '', days: 1 };

  function who(row) {
    const chevron =
      '<svg class="otp__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M9 6l6 6-6 6" /></svg>';
    return (
      '<span class="otp__who">' +
      chevron +
      '<span>' +
      ui.identity(row.who.name, row.who.detail) +
      '</span></span>'
    );
  }

  function fact(label, value, link) {
    const missing = value === '' || value === null || value === undefined;
    // Each pair wrapped, because a `dl` laid out on a grid puts `dt` and `dd` in cells of
    // their own — so a label lands beside the *previous* value and the panel reads as
    // nonsense. HTML5 allows a `div` grouping a term with its definition for exactly this.
    return (
      '<div class="otp__fact"><dt>' +
      ui.escapeHtml(label) +
      '</dt><dd' +
      (missing ? ' class="is-missing"' : '') +
      '>' +
      (missing ? 'Not recorded' : link ? value : ui.escapeHtml(value)) +
      '</dd></div>'
    );
  }

  /** Seconds as something a person reads: "5 min", "1 min 14 s", "0 s". */
  function duration(seconds) {
    const total = Number(seconds) || 0;
    if (total >= 60) {
      const minutes = Math.floor(total / 60);
      const rest = total % 60;
      return minutes + ' min' + (rest ? ' ' + rest + ' s' : '');
    }
    return total + ' s';
  }

  function detail(row) {
    const tone = (OUTCOME[row.outcome] || {}).advice || 'info';
    const blocking = row.blocking;

    const facts = [
      fact('Sent', ui.dateTime(row.sent_at)),
      fact('Expired', ui.dateTime(row.expires_at)),
      fact('Valid for', duration(row.valid_for_seconds)),
      fact('Attempts', row.attempt_count + ' of ' + row.max_attempts),
      // How it was sent and what the gateway called it. Empty on a row that is about a
      // message nobody received is itself the answer, which is why the field is shown rather
      // than hidden when blank.
      fact('Sent via', row.sent_via),
      fact('Gateway reference', row.gateway_message_id),
      fact(
        'Holding up',
        blocking
          ? '<a class="otp__link" href="ai-event.html?id=' +
              blocking.ai_event_id +
              '">AI event ' +
              blocking.ai_event_id +
              '</a> · ' +
              ui.escapeHtml(ui.money(blocking.amount) + ' ' + blocking.mode)
          : '',
        !!blocking
      ),
    ].join('');

    return (
      '<tr class="otp__detail"><td colspan="7"><div class="otp__panel">' +
      '<p class="otp__advice otp__advice--' +
      tone +
      '">' +
      ui.escapeHtml(row.guidance) +
      '</p>' +
      '<dl class="otp__facts">' +
      facts +
      '</dl>' +
      '</div></td></tr>'
    );
  }

  function line(row) {
    const tone = (OUTCOME[row.outcome] || {}).tone;
    return (
      '<tr class="otp__row" data-id="' +
      row.id +
      '" tabindex="0">' +
      '<td>' +
      who(row) +
      '</td>' +
      '<td class="otp__code">' +
      ui.escapeHtml(row.mobile_no || '—') +
      '</td>' +
      '<td>' +
      ui.escapeHtml(row.purpose_display) +
      '</td>' +
      '<td>' +
      ui.pill(row.outcome_display, tone) +
      '</td>' +
      '<td class="table__num otp__attempts">' +
      row.attempt_count +
      ' <small>of ' +
      row.max_attempts +
      '</small></td>' +
      '<td>' +
      ui.dateTime(row.sent_at) +
      '</td>' +
      '<td>' +
      (row.blocking
        ? '<span class="table__name">' +
          ui.escapeHtml(ui.money(row.blocking.amount)) +
          '</span><span class="table__sub">AI event ' +
          row.blocking.ai_event_id +
          '</span>'
        : '<span class="table__sub">Nothing</span>') +
      '</td>' +
      '</tr>'
    );
  }

  /** Filtered on what was fetched — the API returns the whole window up to its cap. */
  function matching() {
    const term = ($('#search').val() || '').trim().toLowerCase();
    if (!term) {
      return state.rows;
    }
    return state.rows.filter(function (row) {
      return (
        String(row.who.name || '')
          .toLowerCase()
          .indexOf(term) >= 0 || String(row.mobile_no || '').indexOf(term) >= 0
      );
    });
  }

  function draw() {
    const rows = matching();
    const searching = !!($('#search').val() || '').trim();

    $('#queue-count').text(
      searching
        ? ui.number(rows.length) + ' of ' + ui.number(state.rows.length)
        : ui.number(state.rows.length) + (state.truncated ? '+ (capped)' : '')
    );
    ui.rows(
      $('#rows'),
      rows,
      line,
      searching ? 'Nobody here matches that.' : 'Nobody is stuck on an OTP.',
      7
    );
  }

  function load() {
    shell.clearAlert();
    $('#rows').attr('aria-busy', 'true');

    const query = { days: state.days };
    if (state.outcome) {
      query.outcome = state.outcome;
    }
    // The two outcomes that only exist among codes nobody typed into. Asked for explicitly,
    // so the default view still matches the count on the Exceptions card.
    if (NEEDS_UNATTEMPTED.indexOf(state.outcome) >= 0) {
      query.include_unattempted = true;
    }
    // A page of 200 is the API's own cap, so one request holds the whole window and the
    // search box can filter without going back to the server for every keystroke.
    query.limit = 200;

    MaitAI.api
      .otpFailures(query)
      .done(function (data) {
        state.rows = data.results || [];
        state.truncated = data.truncated;

        const tally = data.by_outcome || {};
        $('[data-kpi="people"]').text(ui.number(data.people));
        $('[data-kpi="people-foot"]').text(
          ui.number(data.count) + (data.count === 1 ? ' code' : ' codes') + ' between them'
        );
        $('[data-kpi="exhausted"]').text(ui.number(tally.attempts_exhausted || 0));
        $('[data-kpi="never"]').text(ui.number(tally.never_attempted || 0));
        $('[data-kpi="expired"]').text(ui.number(tally.expired || 0));

        draw();
      })
      .fail(function (problem) {
        shell.alert(problem.detail);
        ui.rows($('#rows'), [], line, 'Could not load the queue.', 7);
      });
  }

  function toggleRow($row) {
    const id = Number($row.data('id'));
    const open = $row.hasClass('is-open');
    // One at a time. Two open panels is two answers on screen to a question about one row.
    $('.otp__row').removeClass('is-open');
    $('.otp__detail').remove();
    if (open) {
      return;
    }
    const row = state.rows.filter(function (item) {
      return item.id === id;
    })[0];
    if (row) {
      $row.addClass('is-open').after(detail(row));
    }
  }

  $(function () {
    if (!shell.requireSession()) {
      return;
    }
    shell.mount();
    load();

    $('#window').on('change', function () {
      state.days = Number($(this).val()) || 1;
      load();
    });
    $('#refresh').on('click', load);
    $('#search').on('input', draw);

    $('.chip[data-outcome]').on('click', function () {
      const $chip = $(this);
      $('.chip[data-outcome]').removeClass('is-active').attr('aria-pressed', 'false');
      $chip.addClass('is-active').attr('aria-pressed', 'true');
      state.outcome = $chip.data('outcome') || '';
      load();
    });

    $('#rows').on('click', '.otp__row', function () {
      toggleRow($(this));
    });
    // Openable from the keyboard, because the row is the control and a row nobody can reach
    // by tabbing is a screen half the people in an office cannot work.
    $('#rows').on('keydown', '.otp__row', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleRow($(this));
      }
    });
  });
})(window.MaitAI, jQuery);
