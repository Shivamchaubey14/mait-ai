/**
 * Mait leaderboard (W14).
 *
 * Ranked by AI count, with collections beside it, because the two together are the only
 * honest reading: a high count with a low cash share means events completed without money
 * landing, which is a problem rather than a performance.
 *
 * Bars are scaled to the leader rather than to a target. There is no per-Mait target — the
 * villages differ by an order of magnitude in size — so the comparison that means anything is
 * against the best Mait working the same week.
 */

(function (MaitAI, $) {
  'use strict';

  const ui = MaitAI.ui;

  function cashShare(entry) {
    const total = Number(entry.amount_collected) || 0;
    if (!total) {
      return null;
    }
    return Math.round(((Number(entry.cod_amount) || 0) / total) * 100);
  }

  function row(entry, index, leader) {
    const share = cashShare(entry);
    const relative = leader ? Math.round((entry.ai_count / leader) * 100) : 0;

    return (
      '<tr>' +
      '<td class="table__num">' +
      (index + 1) +
      '</td>' +
      '<td>' +
      ui.identity(entry.name, entry.sahayak_vendor_code) +
      '</td>' +
      '<td>' +
      '<span class="table__num">' +
      ui.number(entry.ai_count) +
      '</span> ' +
      // Below half the leader is worth a second look, so it is coloured rather than left to
      // be worked out from bar lengths.
      ui.bar(relative, relative < 50 ? 'behind' : null) +
      '</td>' +
      '<td class="table__num">' +
      ui.money(entry.amount_collected) +
      '</td>' +
      '<td class="table__num">' +
      (share === null ? '—' : share + '%') +
      '</td>' +
      '</tr>'
    );
  }

  function load(days) {
    MaitAI.shell.clearAlert();
    $('#period-label').text('Last ' + days + ' days');

    MaitAI.api
      .maitPerformance({ days: days })
      .done(function (data) {
        const results = data.results || [];
        const leader = results.length ? results[0].ai_count : 0;

        ui.rows(
          $('#rows'),
          results,
          function (entry, index) {
            return row(entry, index, leader);
          },
          'No AI events were recorded in this period.',
          5
        );

        $('#foot').text(
          results.length
            ? 'Bars are relative to the leading Mait. Yellow marks anyone below half of them.'
            : ''
        );
      })
      .fail(function (problem) {
        MaitAI.shell.alert(problem.detail);
        ui.rows($('#rows'), [], null, 'Could not load the leaderboard.', 5);
      });
  }

  $(function () {
    if (!MaitAI.shell.requireSession()) {
      return;
    }
    MaitAI.shell.mount();
    load(Number($('#period').val()));

    $('#period').on('change', function () {
      load(Number($(this).val()));
    });
  });
})(window.MaitAI, jQuery);
