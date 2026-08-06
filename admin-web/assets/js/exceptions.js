/**
 * Exceptions (W16).
 *
 * Everything that needs a human, in one place, so the morning triage is one screen rather
 * than four. The dashboard shows the same four queues as a summary; this is where they are
 * worked.
 *
 * Each queue carries its full count next to a bounded sample: the count says how bad it is,
 * the sample says where to start. Showing only the sample would let a queue of six hundred
 * look like a queue of five.
 */

(function (MaitAI, $) {
  'use strict';

  const ui = MaitAI.ui;

  const QUEUES = ['pending-payments', 'failed-otps', 'low-stock', 'stale-indents'];
  const KEY = {
    'pending-payments': 'pending_payments',
    'failed-otps': 'failed_otps',
    'low-stock': 'low_stock',
    'stale-indents': 'stale_indents',
  };

  function renderQueue(name, queue) {
    const rows = queue.rows || [];
    $('[data-count="' + name + '"]').text(ui.number(queue.count || 0));

    if (!rows.length) {
      // Named rather than blank: an empty queue is good news and should read as good news.
      $('[data-rows="' + name + '"]').html('<p class="exception__meta">Nothing waiting.</p>');
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

    const remaining = (queue.count || 0) - rows.length;
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

        QUEUES.forEach(function (name) {
          const queue = exceptions[KEY[name]] || {};
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
    load();
    $('#refresh').on('click', load);
  });
})(window.MaitAI, jQuery);
