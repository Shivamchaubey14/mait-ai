/**
 * Exceptions (W16).
 *
 * Everything that needs a human, in one place, so the morning triage is one screen rather
 * than five. The dashboard shows the same queues as a summary; this is where they are
 * worked.
 *
 * Each queue carries its full count next to a bounded sample: the count says how bad it is,
 * the sample says where to start. Showing only the sample would let a queue of six hundred
 * look like a queue of five.
 */

(function (MaitAI, $) {
  'use strict';

  const ui = MaitAI.ui;

  const QUEUES = [
    'pending-payments',
    'failed-otps',
    'low-stock',
    'stale-indents',
    'overdue-checks',
    'declined-checks',
  ];
  const KEY = {
    'pending-payments': 'pending_payments',
    'failed-otps': 'failed_otps',
    'low-stock': 'low_stock',
    'stale-indents': 'stale_indents',
    'overdue-checks': 'overdue_checks',
    'declined-checks': 'declined_checks',
  };

  const state = { queues: {} };

  /**
   * Searched across every queue at once.
   *
   * Triage starts from a name or a number — a Mait who rang in, an event someone is asking
   * about — and which of the four queues it landed in is the thing being looked up, not
   * something already known.
   */
  function matching(rows) {
    const term = ($('#search').val() || '').trim().toLowerCase();
    if (!term) {
      return rows;
    }
    return rows.filter(function (row) {
      return (
        String(row.label || '')
          .toLowerCase()
          .indexOf(term) >= 0 ||
        String(row.meta || '')
          .toLowerCase()
          .indexOf(term) >= 0
      );
    });
  }

  function renderQueue(name, queue) {
    const searching = !!($('#search').val() || '').trim();
    const all = queue.rows || [];
    const rows = matching(all);
    $('[data-count="' + name + '"]').text(
      searching ? rows.length + ' of ' + ui.number(queue.count || 0) : ui.number(queue.count || 0)
    );

    // Follows the queue's own count, not the search. A term that matches none of the five
    // sampled rows does not mean the queue behind the card is empty.
    ui.queueLink(name, queue.count);

    if (!rows.length) {
      // Named rather than blank: an empty queue is good news and should read as good news.
      $('[data-rows="' + name + '"]').html(
        '<p class="exception__meta">' +
          (searching && all.length ? 'Nothing here matches.' : 'Nothing waiting.') +
          '</p>'
      );
      return;
    }

    const html = rows
      .map(function (row) {
        return (
          '<div class="exception__row">' +
          '<p class="exception__label">' +
          ui.escapeHtml(row.label) +
          '</p>' +
          '<p class="exception__meta' +
          (row.severity === 'error' ? ' exception__meta--error' : '') +
          '">' +
          ui.escapeHtml(row.meta) +
          '</p>' +
          '</div>'
        );
      })
      .join('');

    // Only meaningful against the full queue. While searching, "N more" would be counting
    // rows that were never on this page to begin with.
    //
    // Every queue states `more` itself, and it wins. Subtracting the sample from the count
    // assumes the two are the same unit, and only one queue's ever were: the rest count
    // events and sample the people or the categories behind them, so a row that already
    // accounted for everything still read as "N more" underneath. The subtraction is kept
    // only as a fallback for a queue served by an older API than this file.
    const stated = queue.more;
    const remaining = searching
      ? 0
      : typeof stated === 'number'
        ? stated
        : (queue.count || 0) - all.length;
    $('[data-rows="' + name + '"]').html(
      html +
        (remaining > 0
          ? '<div class="exception__row"><p class="exception__meta">' +
            ui.number(remaining) +
            ' more</p></div>'
          : '')
    );
  }

  function load() {
    MaitAI.shell.clearAlert();
    MaitAI.api
      .dashboardSummary()
      .done(function (data) {
        const exceptions = data.exceptions || {};
        let total = 0;

        state.queues = {};
        QUEUES.forEach(function (name) {
          const queue = exceptions[KEY[name]] || {};
          state.queues[name] = queue;
          total += queue.count || 0;
          renderQueue(name, queue);
        });

        MaitAI.shell.setExceptionCount(total);
      })
      .fail(function (problem) {
        MaitAI.shell.alert(problem.detail);
      });
  }

  $(function () {
    if (!MaitAI.shell.requireSession()) {
      return;
    }
    MaitAI.shell.mount();
    // Every card opens its own queue over this page.
    MaitAI.queueModal.mount();
    load();
    $('#refresh').on('click', load);

    // Filtered on the sample already fetched. Each queue ships a bounded sample rather than
    // the whole thing, so the counts keep saying how deep the queue really is.
    $('#search').on('input', function () {
      QUEUES.forEach(function (name) {
        renderQueue(name, state.queues[name] || {});
      });
    });
  });
})(window.MaitAI, jQuery);
