/**
 * MPP coverage (W15).
 *
 * Coverage is the number the business is actually judged on: not how many inseminations were
 * recorded, but how much of the member base was reached. A district can look busy on the
 * leaderboard while most of its members have never been served.
 *
 * An MPP at zero is called out separately from one that is merely behind. Zero almost always
 * means no Mait or no stock — a structural problem someone has to fix — while "behind" is a
 * matter of visits.
 */

(function (MaitAI, $) {
  'use strict';

  const ui = MaitAI.ui;

  function tone(percent) {
    if (!percent) {
      return 'bad';
    }
    if (percent < 20) {
      return 'behind';
    }
    return null;
  }

  /**
   * Zero has three causes and three different people to call: nobody is assigned to the
   * village, somebody is but cannot log in, or they can and have not been. The API says which
   * — before it did not, and every zero was reported as "Mait inactive".
   */
  function label(mpp) {
    if (!mpp.coverage_percent) {
      if (!mpp.mait_code) {
        return 'No Mait assigned';
      }
      if (!mpp.mait_activated) {
        return 'Mait not activated';
      }
      return 'Nothing yet';
    }
    if (mpp.coverage_percent >= 40) {
      return 'Strong';
    }
    if (mpp.coverage_percent >= 20) {
      return 'On track';
    }
    return 'Behind';
  }

  function row(mpp) {
    const percent = mpp.coverage_percent || 0;
    return (
      '<tr' +
      (percent ? '' : ' class="is-blocked"') +
      '>' +
      '<td>' +
      ui.identity(mpp.mpp_name, mpp.mpp_code) +
      '</td>' +
      '<td>' +
      ui.escapeHtml(mpp.district_code || '—') +
      '</td>' +
      '<td class="table__num">' +
      ui.number(mpp.total_members) +
      '</td>' +
      '<td class="table__num">' +
      ui.number(mpp.members_served) +
      '</td>' +
      // Figure, bar, word — in a flex row, so the column lines up down the page rather than
      // each cell flowing to whatever width its own pill happens to need.
      '<td><div class="meter">' +
      '<span class="meter__value">' +
      percent +
      '%</span>' +
      ui.bar(percent, tone(percent)) +
      ui.pill(label(mpp), percent >= 40 ? 'good' : percent ? 'warn' : 'bad') +
      '</div></td>' +
      '</tr>'
    );
  }

  function load(days) {
    MaitAI.shell.clearAlert();
    MaitAI.api
      .mppCoverage({ days: days })
      .done(function (data) {
        const results = data.results || [];
        // The network, computed server-side over every active MPP that has members. Totalling
        // the rows would describe the hundred largest villages while wearing the word "every".
        const summary = data.summary || {};

        $('#served').text(ui.number(summary.members_served));
        $('#served-foot').text('Of ' + ui.number(summary.members) + ' on the master');
        $('#coverage').text(summary.members ? summary.coverage_percent + '%' : '—');
        $('#above').text(ui.number(summary.mpps_above_40));
        $('#above-foot').text('Of ' + ui.number(summary.mpps) + ' MPPs with members');
        $('#zero').text(ui.number(summary.mpps_at_zero));

        // Says what the table is, so nobody totals it and calls the answer the network.
        $('#rows-note').text(
          summary.mpps > results.length
            ? 'Largest ' + ui.number(results.length) + ' of ' + ui.number(summary.mpps)
            : ui.number(results.length) + ' MPPs'
        );

        ui.rows($('#rows'), results, row, 'No coverage data for this period.', 5);
      })
      .fail(function (problem) {
        MaitAI.shell.alert(problem.detail);
        ui.rows($('#rows'), [], row, 'Could not load coverage.', 5);
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
