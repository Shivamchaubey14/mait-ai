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

  function label(mpp) {
    if (!mpp.coverage_percent) {
      return mpp.members_served === 0 && !mpp.mait_activated ? 'Mait inactive' : 'Nothing yet';
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
      '<td>' +
      '<span class="table__num">' +
      percent +
      '%</span> ' +
      ui.bar(percent, tone(percent)) +
      ' ' +
      ui.pill(label(mpp), percent >= 40 ? 'good' : percent ? 'warn' : 'bad') +
      '</td>' +
      '</tr>'
    );
  }

  function load(days) {
    MaitAI.shell.clearAlert();
    MaitAI.api
      .mppCoverage({ days: days })
      .done(function (data) {
        const results = data.results || [];

        const served = results.reduce(function (sum, mpp) {
          return sum + (mpp.members_served || 0);
        }, 0);
        const total = results.reduce(function (sum, mpp) {
          return sum + (mpp.total_members || 0);
        }, 0);
        const above = results.filter(function (mpp) {
          return (mpp.coverage_percent || 0) >= 40;
        }).length;
        const zero = results.filter(function (mpp) {
          return !mpp.coverage_percent;
        }).length;

        $('#served').text(ui.number(served));
        $('#served-foot').text('Of ' + ui.number(total) + ' on the master');
        $('#coverage').text(total ? Math.round((served / total) * 1000) / 10 + '%' : '—');
        $('#above').text(ui.number(above));
        $('#above-foot').text('Of ' + ui.number(results.length));
        $('#zero').text(ui.number(zero));

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
