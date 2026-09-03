/**
 * The Failed OTPs queue, opened in place (W16).
 *
 * The Exceptions card can mask a number and count it. `981234••••  3 failure(s) today` says
 * somebody is stuck and nothing else — not who, not what they were trying to do, and not which
 * of four quite different things went wrong. This is the rest of it, and it opens over the
 * card rather than replacing the screen: triage is a scan of six queues, and a link that takes
 * an operator off the page to answer one of them costs them the other five and a click back.
 *
 * **A `<dialog>`, the same as the photo viewer**, and for the same reasons: the browser
 * already traps focus, gives Escape its meaning, returns focus to whatever opened it, and
 * marks the page behind it inert for a screen reader. None of that is worth reimplementing.
 * It owns its own markup and is built on first use, so a page adopting it pastes no HTML —
 * which is what keeps the dashboard's copy and the Exceptions copy from drifting apart.
 *
 * **The four outcomes are the substance.** Attempts used up means ring the person. *Never
 * entered* means the message probably never arrived, which is a gateway problem rather than a
 * person's — and it is invisible on the card, which counts only codes somebody typed into.
 * *Ran out of time* is ordinary. And *replaced* is not a failure at all: asking for a second
 * code expires the first, so every resend leaves a row behind that looks exactly like an
 * undelivered message.
 */

window.MaitAI = window.MaitAI || {};

(function (MaitAI, $) {
  'use strict';

  const ui = MaitAI.ui;

  //: Built once, on first open, and kept — the same bargain the lightbox makes.
  let dialog = null;

  const state = { rows: [], outcome: '', days: 1, truncated: false };

  /**
   * The tone each outcome is drawn in.
   *
   * `superseded` is deliberately green. It is what happens to a code when somebody asks for
   * another one, so it is not a fault — and it is the most common row on the screen once the
   * untouched codes are shown, which is exactly why it must not look like one.
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
   * The queue excludes those by default because the card excludes them, and a modal opened
   * from a card saying "2" should not show sixty-six rows. Picking either chip widens the
   * request, which is what asking for "never entered" meant.
   */
  const NEEDS_UNATTEMPTED = ['never_attempted', 'superseded'];

  const CHIPS = [
    ['', 'All', null],
    ['attempts_exhausted', 'Attempts used up', 'bad'],
    ['never_attempted', 'Never entered', 'warn'],
    ['expired', 'Ran out of time', null],
    ['superseded', 'Replaced', null],
    ['open', 'Still open', null],
  ];

  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';

  function build() {
    dialog = document.createElement('dialog');
    dialog.className = 'otp';
    dialog.id = 'otp-modal';
    dialog.setAttribute('aria-labelledby', 'otp-title');
    dialog.innerHTML =
      '<header class="otp__bar">' +
      '<div><h2 class="otp__title" id="otp-title">Failed OTPs</h2>' +
      '<p class="otp__sub">Who is stuck, and which of the four things went wrong</p></div>' +
      '<select class="select otp__window" data-otp="window" aria-label="How far back">' +
      '<option value="1">Today</option>' +
      '<option value="7">Last 7 days</option>' +
      '<option value="30">Last 30 days</option>' +
      '</select>' +
      '<button class="otp__close" type="button" data-otp="close" aria-label="Close">' +
      ICON +
      '<path d="M18 6 6 18M6 6l12 12" /></svg></button>' +
      '</header>' +
      '<p class="otp__tally" data-otp="tally"></p>' +
      '<div class="otp__chips" role="group" aria-label="Filter by what happened">' +
      CHIPS.map(function (chip) {
        return (
          '<button class="chip' +
          (chip[2] ? ' chip--' + chip[2] : '') +
          (chip[0] === '' ? ' is-active' : '') +
          '" type="button" data-outcome="' +
          chip[0] +
          '" aria-pressed="' +
          (chip[0] === '' ? 'true' : 'false') +
          '">' +
          chip[1] +
          '</button>'
        );
      }).join('') +
      '</div>' +
      '<div class="otp__list" data-otp="list" aria-busy="true"></div>';

    document.body.appendChild(dialog);
    wire();
  }

  /** Seconds as something a person reads: "5 min", "1 min 14 s", "0 s". */
  function duration(seconds) {
    const total = Number(seconds) || 0;
    if (total < 60) {
      return total + ' s';
    }
    const minutes = Math.floor(total / 60);
    const rest = total % 60;
    return minutes + ' min' + (rest ? ' ' + rest + ' s' : '');
  }

  function fact(label, value, isHtml) {
    const missing = value === '' || value === null || value === undefined;
    return (
      '<div class="otp__fact"><dt>' +
      ui.escapeHtml(label) +
      '</dt><dd' +
      (missing ? ' class="is-missing"' : '') +
      '>' +
      (missing ? 'Not recorded' : isHtml ? value : ui.escapeHtml(value)) +
      '</dd></div>'
    );
  }

  function detail(row) {
    const blocking = row.blocking;
    const facts = [
      fact('Sent', ui.dateTime(row.sent_at)),
      fact('Expired', ui.dateTime(row.expires_at)),
      fact('Valid for', duration(row.valid_for_seconds)),
      fact('Attempts', row.attempt_count + ' of ' + row.max_attempts),
      // Shown even when empty. On a row that is about a message nobody received, an empty
      // gateway reference is itself the answer.
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
      '<div class="otp__detail">' +
      '<p class="otp__advice otp__advice--' +
      ((OUTCOME[row.outcome] || {}).advice || 'info') +
      '">' +
      ui.escapeHtml(row.guidance) +
      '</p><dl class="otp__facts">' +
      facts +
      '</dl></div>'
    );
  }

  function card(row) {
    const tone = (OUTCOME[row.outcome] || {}).tone;
    return (
      '<article class="otp__entry" data-id="' +
      row.id +
      '">' +
      '<button class="otp__summary" type="button" aria-expanded="false">' +
      '<span class="otp__chevron" aria-hidden="true">' +
      ICON +
      '<path d="M9 6l6 6-6 6" /></svg></span>' +
      '<span class="otp__person">' +
      ui.identity(row.who.name, row.who.detail) +
      '</span>' +
      '<span class="otp__number">' +
      ui.escapeHtml(row.mobile_no || '—') +
      '</span>' +
      '<span class="otp__purpose">' +
      ui.escapeHtml(row.purpose_display) +
      '</span>' +
      '<span class="otp__state">' +
      ui.pill(row.outcome_display, tone) +
      '</span>' +
      '<span class="otp__tries">' +
      row.attempt_count +
      '<small> of ' +
      row.max_attempts +
      '</small></span>' +
      '<span class="otp__when">' +
      ui.dateTime(row.sent_at) +
      '</span>' +
      '</button></article>'
    );
  }

  function render() {
    const $list = $(dialog).find('[data-otp="list"]').removeAttr('aria-busy');
    if (!state.rows.length) {
      $list.html('<p class="otp__empty">Nobody is stuck on an OTP here.</p>');
      return;
    }
    $list.html(state.rows.map(card).join(''));
  }

  function renderTally(data) {
    const tally = data.by_outcome || {};
    const parts = [
      ui.number(data.people) + (data.people === 1 ? ' person' : ' people'),
      ui.number(data.count) + (data.count === 1 ? ' code' : ' codes'),
    ];
    // Only the outcomes actually present. A row of five zeros says nothing and pushes the
    // rows that matter further down a dialog that is already short of height.
    CHIPS.slice(1).forEach(function (chip) {
      if (tally[chip[0]]) {
        parts.push(ui.number(tally[chip[0]]) + ' ' + chip[1].toLowerCase());
      }
    });
    $(dialog)
      .find('[data-otp="tally"]')
      .text(parts.join(' · ') + (data.truncated ? ' · capped' : ''));
  }

  function load() {
    const $list = $(dialog).find('[data-otp="list"]');
    $list.attr('aria-busy', 'true').html('<p class="otp__empty">Loading…</p>');

    const query = { days: state.days, limit: 200 };
    if (state.outcome) {
      query.outcome = state.outcome;
    }
    if (NEEDS_UNATTEMPTED.indexOf(state.outcome) >= 0) {
      query.include_unattempted = true;
    }

    MaitAI.api
      .otpFailures(query)
      .done(function (data) {
        state.rows = data.results || [];
        state.truncated = data.truncated;
        renderTally(data);
        render();
      })
      .fail(function (problem) {
        $list
          .removeAttr('aria-busy')
          .html('<p class="otp__empty">' + ui.escapeHtml(problem.detail) + '</p>');
      });
  }

  function toggle($entry) {
    const open = $entry.hasClass('is-open');
    // One at a time: two open panels is two answers on screen to a question about one row.
    $(dialog)
      .find('.otp__entry')
      .removeClass('is-open')
      .find('.otp__summary')
      .attr('aria-expanded', 'false');
    $(dialog).find('.otp__detail').remove();
    if (open) {
      return;
    }
    const id = Number($entry.data('id'));
    const row = state.rows.filter(function (item) {
      return item.id === id;
    })[0];
    if (row) {
      $entry.addClass('is-open').find('.otp__summary').attr('aria-expanded', 'true');
      $entry.append(detail(row));
    }
  }

  function wire() {
    const $dialog = $(dialog);

    $dialog.on('click', '[data-otp="close"]', function () {
      dialog.close();
    });

    $dialog.on('change', '[data-otp="window"]', function () {
      state.days = Number($(this).val()) || 1;
      load();
    });

    $dialog.on('click', '.chip[data-outcome]', function () {
      const $chip = $(this);
      $dialog.find('.chip[data-outcome]').removeClass('is-active').attr('aria-pressed', 'false');
      $chip.addClass('is-active').attr('aria-pressed', 'true');
      state.outcome = $chip.attr('data-outcome') || '';
      load();
    });

    // The summary is a real button, so Enter and Space come free and there is nothing to
    // handle for the keyboard.
    $dialog.on('click', '.otp__summary', function () {
      toggle($(this).closest('.otp__entry'));
    });

    /**
     * Clicking the dark area closes it.
     *
     * A backdrop click is dispatched to the dialog itself — there is no node to bind to — so
     * this asks where the pointer landed rather than what it hit. `e.target === dialog` alone
     * would also fire on the dialog's own padding and cannot tell the two apart.
     */
    $dialog.on('click', function (e) {
      if (e.target !== dialog) {
        return;
      }
      const r = dialog.getBoundingClientRect();
      const outside =
        e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      if (outside) {
        dialog.close();
      }
    });

    // Nothing left loaded behind a closed dialog. These rows carry farmers' and Maits' phone
    // numbers, and a copy sitting in a hidden node is one more place they exist.
    $dialog.on('close', function () {
      $dialog.find('[data-otp="list"]').empty();
      state.rows = [];
    });
  }

  MaitAI.otpModal = {
    /**
     * Open the queue over whatever screen asked for it.
     *
     * Opens on today, the same window the card counted, so the number somebody just read on
     * the card is the number of rows they get. The select widens it from there.
     */
    open: function () {
      if (!dialog) {
        build();
      }
      state.outcome = '';
      state.days = 1;
      $(dialog).find('.chip[data-outcome]').removeClass('is-active').attr('aria-pressed', 'false');
      $(dialog).find('.chip[data-outcome=""]').addClass('is-active').attr('aria-pressed', 'true');
      $(dialog).find('[data-otp="window"]').val('1');
      // `showModal`, not `show`: it is what makes the page behind inert and gives Escape its
      // meaning. Guarded because a dialog already open throws on a second call.
      if (!dialog.open) {
        dialog.showModal();
      }
      load();
    },

    /** Wire every `[data-otp-modal]` trigger on the page. */
    mount: function () {
      $(document).on('click', '[data-otp-modal]', function (event) {
        event.preventDefault();
        MaitAI.otpModal.open();
      });
    },
  };
})(window.MaitAI, jQuery);
