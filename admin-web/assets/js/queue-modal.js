/**
 * Any exception queue, opened in place (W16).
 *
 * The cards on Exceptions carry a count and three sampled lines. That is right for a card and
 * it answers almost nothing: `Approved, not issued — 4 older than 3 days` names a number
 * without saying which four, whose they are, or what they asked for. Every card used to end
 * in a link that took the operator off a screen showing six queues in order to answer one of
 * them, and triage is a scan of all six.
 *
 * So the detail opens over the card. One dialog serves all six queues, because the API answers
 * them all in one row shape — title, subtitle, detail, state, metric, when, plus a guidance
 * sentence, a list of facts and somewhere to go. The columns mean different things from queue
 * to queue (a payment's metric is an amount, an indent's is an age) and that is fine: an
 * operator reads them in the same places every time.
 *
 * **A `<dialog>`, the same as the photo viewer**, and for the same reasons: focus trapping,
 * Escape, focus returning to the card and the page behind marked inert all come from the
 * browser. It owns its own markup and builds on first use, so a page adopting it pastes no
 * HTML — which is what keeps the dashboard's copy of these cards and the Exceptions copy from
 * drifting apart.
 *
 * **`guidance` is the reason this exists.** Each of these queues has several causes wearing
 * one label, and the cause decides who gets rung. A pending payment waiting on a farmer's
 * authorisation and one waiting on a Mait's screenshot are the same row on the card and two
 * different phone calls.
 */

window.MaitAI = window.MaitAI || {};

(function (MaitAI, $) {
  'use strict';

  const ui = MaitAI.ui;

  //: Built once, on first open, and kept — the same bargain the lightbox makes.
  let dialog = null;

  const state = { queue: '', rows: [], filter: '', days: null };

  /**
   * Which queues are windowed, and what the select offers.
   *
   * The API says whether a queue has a window and which one it opened on; this only says
   * what the choices are, and `renderWindow` selects whichever the response came back with.
   * That is what keeps the dialog showing the number somebody just read on the card — rather
   * than this file holding a second opinion about the default and the two drifting.
   */
  const WINDOWS = {
    'failed-otps': [
      [1, 'Today'],
      [7, 'Last 7 days'],
      [30, 'Last 30 days'],
      [90, 'Last 90 days'],
    ],
    'declined-checks': [
      [30, 'Last 30 days'],
      [90, 'Last 90 days'],
      [365, 'Last year'],
    ],
  };

  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';

  /** Failed OTPs keeps its own endpoint; the other five share one. */
  function fetchQueue() {
    const query = {};
    if (state.filter) {
      query.filter = state.filter;
    }
    if (state.days) {
      query.days = state.days;
    }
    if (state.queue === 'failed-otps') {
      query.limit = 200;
      return MaitAI.api.otpFailures(query);
    }
    return MaitAI.api.exceptionQueue(state.queue, query);
  }

  function build() {
    dialog = document.createElement('dialog');
    dialog.className = 'queue';
    dialog.id = 'queue-modal';
    dialog.setAttribute('aria-labelledby', 'queue-title');
    dialog.innerHTML =
      '<header class="queue__bar">' +
      '<div><h2 class="queue__title" id="queue-title"></h2>' +
      '<p class="queue__sub" data-q="subtitle"></p></div>' +
      '<select class="select queue__window" data-q="window" aria-label="How far back" ' +
      'hidden></select>' +
      '<button class="queue__close" type="button" data-q="close" aria-label="Close">' +
      ICON +
      '<path d="M18 6 6 18M6 6l12 12" /></svg></button>' +
      '</header>' +
      '<p class="queue__tally" data-q="tally"></p>' +
      '<div class="queue__chips" data-q="chips" role="group" ' +
      'aria-label="Filter by cause"></div>' +
      '<div class="queue__list" data-q="list" aria-busy="true"></div>';

    document.body.appendChild(dialog);
    wire();
  }

  function factLine(item) {
    const missing = item.value === '' || item.value === null || item.value === undefined;
    const value = item.href
      ? '<a class="queue__link" href="' +
        ui.escapeHtml(item.href) +
        '">' +
        ui.escapeHtml(item.value) +
        '</a>'
      : ui.escapeHtml(item.value);
    return (
      '<div class="queue__fact"><dt>' +
      ui.escapeHtml(item.label) +
      '</dt><dd' +
      (missing ? ' class="is-missing"' : '') +
      '>' +
      (missing ? 'Not recorded' : value) +
      '</dd></div>'
    );
  }

  /**
   * Timestamps are rendered here, not by the API.
   *
   * The API sends ISO instants; every screen in this portal shows "02 Sep 14:04". A fact whose
   * value happens to parse as a date gets that treatment so a panel does not mix the two.
   */
  function factValue(item) {
    if (/^\d{4}-\d{2}-\d{2}T/.test(String(item.value))) {
      return $.extend({}, item, { value: ui.dateTime(item.value) });
    }
    return item;
  }

  function detail(row) {
    const facts = (row.facts || []).map(factValue).map(factLine).join('');
    const link = row.link
      ? '<a class="btn btn--soft queue__go" href="' +
        ui.escapeHtml(row.link.href) +
        '">' +
        ui.escapeHtml(row.link.label) +
        '</a>'
      : '';
    return (
      '<div class="queue__detail">' +
      '<div class="queue__advice queue__advice--' +
      ((row.state || {}).tone || 'info') +
      '"><p>' +
      ui.escapeHtml(row.guidance) +
      '</p>' +
      link +
      '</div>' +
      '<dl class="queue__facts">' +
      facts +
      '</dl></div>'
    );
  }

  function card(row, index) {
    return (
      '<article class="queue__entry" data-index="' +
      index +
      '">' +
      '<button class="queue__summary" type="button" aria-expanded="false">' +
      '<span class="queue__chevron" aria-hidden="true">' +
      ICON +
      '<path d="M9 6l6 6-6 6" /></svg></span>' +
      '<span class="queue__who">' +
      ui.identity(row.title, row.subtitle) +
      '</span>' +
      '<span class="queue__what">' +
      ui.escapeHtml(row.detail || '') +
      '</span>' +
      '<span class="queue__state">' +
      ui.pill((row.state || {}).label || '', (row.state || {}).tone) +
      '</span>' +
      '<span class="queue__metric">' +
      ui.escapeHtml(row.metric || '') +
      '</span>' +
      '<span class="queue__when">' +
      (row.when ? ui.dateTime(row.when) : '') +
      '</span>' +
      '</button></article>'
    );
  }

  function renderChips(data) {
    const buckets = (data.buckets || []).filter(function (bucket) {
      // Only the causes actually present. A chip that answers empty is a chip that reads as
      // broken, and a row of five zeros pushes the rows that matter down a short dialog.
      return bucket.count > 0 || bucket.key === state.filter;
    });
    const $chips = $(dialog).find('[data-q="chips"]');
    if (!buckets.length) {
      $chips.empty().prop('hidden', true);
      return;
    }
    $chips.prop('hidden', false).html(
      [{ key: '', label: 'All', tone: null, count: data.shown }]
        .concat(buckets)
        .map(function (bucket) {
          return (
            '<button class="chip' +
            (bucket.tone ? ' chip--' + bucket.tone : '') +
            (bucket.key === state.filter ? ' is-active' : '') +
            '" type="button" data-filter="' +
            ui.escapeHtml(bucket.key) +
            '" aria-pressed="' +
            (bucket.key === state.filter) +
            '">' +
            ui.escapeHtml(bucket.label) +
            (bucket.key ? ' <small>' + ui.number(bucket.count) + '</small>' : '') +
            '</button>'
          );
        })
        .join('')
    );
  }

  function renderWindow(data) {
    const $select = $(dialog).find('[data-q="window"]');
    const choices = WINDOWS[state.queue];
    if (!data.windowed || !choices) {
      $select.prop('hidden', true);
      return;
    }
    $select
      .prop('hidden', false)
      .html(
        choices
          .map(function (choice) {
            return '<option value="' + choice[0] + '">' + choice[1] + '</option>';
          })
          .join('')
      )
      .val(String(data.window_days));
  }

  function render(data) {
    const $dialog = $(dialog);
    $dialog.find('#queue-title').text(data.title);
    $dialog.find('[data-q="subtitle"]').text(data.subtitle);

    // The full count first, then how much of it is on screen. A queue of six hundred must not
    // read as a queue of two hundred because that is where the API stopped.
    const parts = [ui.number(data.count) + ' in this queue'];
    if (state.filter) {
      parts.push(ui.number(data.results.length) + ' shown');
    }
    if (data.truncated) {
      parts.push('capped at ' + ui.number(data.shown));
    }
    $dialog.find('[data-q="tally"]').text(parts.join(' · '));

    renderWindow(data);
    renderChips(data);

    state.rows = data.results || [];
    const $list = $dialog.find('[data-q="list"]').removeAttr('aria-busy');
    if (!state.rows.length) {
      $list.html(
        '<p class="queue__empty">' +
          (state.filter ? 'Nothing in this queue matches that.' : 'Nothing waiting here.') +
          '</p>'
      );
      return;
    }
    $list.html(state.rows.map(card).join(''));
  }

  function load() {
    const $list = $(dialog).find('[data-q="list"]');
    $list.attr('aria-busy', 'true').html('<p class="queue__empty">Loading…</p>');

    fetchQueue()
      .done(render)
      .fail(function (problem) {
        $list
          .removeAttr('aria-busy')
          .html('<p class="queue__empty">' + ui.escapeHtml(problem.detail) + '</p>');
      });
  }

  function toggle($entry) {
    const open = $entry.hasClass('is-open');
    // One at a time: two open panels is two answers on screen to a question about one row.
    $(dialog)
      .find('.queue__entry')
      .removeClass('is-open')
      .find('.queue__summary')
      .attr('aria-expanded', 'false');
    $(dialog).find('.queue__detail').remove();
    if (open) {
      return;
    }
    const row = state.rows[Number($entry.data('index'))];
    if (row) {
      $entry.addClass('is-open').find('.queue__summary').attr('aria-expanded', 'true');
      $entry.append(detail(row));
    }
  }

  function wire() {
    const $dialog = $(dialog);

    $dialog.on('click', '[data-q="close"]', function () {
      dialog.close();
    });

    $dialog.on('change', '[data-q="window"]', function () {
      state.days = Number($(this).val()) || null;
      load();
    });

    $dialog.on('click', '.chip[data-filter]', function () {
      state.filter = $(this).attr('data-filter') || '';
      load();
    });

    // The summary is a real button, so Enter and Space come free and there is nothing to
    // handle for the keyboard.
    $dialog.on('click', '.queue__summary', function () {
      toggle($(this).closest('.queue__entry'));
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

    // Nothing left loaded behind a closed dialog. These rows carry farmers' and Maits' names
    // and phone numbers, and a copy sitting in a hidden node is one more place they exist.
    $dialog.on('close', function () {
      $dialog.find('[data-q="list"]').empty();
      state.rows = [];
    });
  }

  MaitAI.queueModal = {
    /**
     * Open one queue over whatever screen asked for it.
     *
     * Always opens unfiltered and on the queue's own default window, so the number somebody
     * just read on the card is the number of rows they get.
     */
    open: function (queue) {
      if (!dialog) {
        build();
      }
      state.queue = queue;
      state.filter = '';
      state.days = null;
      if (!dialog.open) {
        // `showModal`, not `show`: it is what makes the page behind inert and gives Escape
        // its meaning. Guarded because a dialog already open throws on a second call.
        dialog.showModal();
      }
      load();
    },

    /** Wire every `[data-queue]` trigger on the page. */
    mount: function () {
      $(document).on('click', '[data-queue]', function (event) {
        event.preventDefault();
        MaitAI.queueModal.open($(this).attr('data-queue'));
      });
    },
  };
})(window.MaitAI, jQuery);
