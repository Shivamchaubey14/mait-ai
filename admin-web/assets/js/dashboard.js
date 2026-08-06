/**
 * Admin dashboard (W2, SRS §6.7).
 *
 * Reads pre-aggregated endpoints only. Never ask the API to compute over raw events from
 * here — the §7 target is a P95 under 400ms, and the aggregation tables exist for this page.
 *
 * Every number renders through the same path whether it is 418,772 or zero. A dashboard that
 * only looks right once there is data is a dashboard nobody trusts on day one.
 */

(function ($, MaitAI) {
  'use strict';

  const api = MaitAI.api;

  // ------------------------------------------------------------------------------------
  // Formatting
  // ------------------------------------------------------------------------------------
  function count(value) {
    return typeof value === 'number' ? value.toLocaleString('en-IN') : '—';
  }

  function delta(percent, comparedTo) {
    if (typeof percent !== 'number') {
      return '';
    }
    const up = percent >= 0;
    return {
      text: (up ? '+' : '−') + Math.abs(percent).toFixed(0) + '% ' + comparedTo,
      className: up ? 'kpi__foot--up' : 'kpi__foot--down',
    };
  }

  function setFoot(selector, value) {
    const $el = $('[data-kpi="' + selector + '"]').removeClass('kpi__foot--up kpi__foot--down');
    if (!value) {
      $el.text('');
    } else if (typeof value === 'string') {
      $el.text(value);
    } else {
      $el.text(value.text).addClass(value.className);
    }
  }

  function showError(problem) {
    $('#alert-region').html(
      $('<div class="alert alert--error"></div>').text(MaitAI.api.problemToLines(problem)[0])
    );
  }

  // ------------------------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------------------------
  function renderSummary(data) {
    $('[data-kpi="today"]').text(count(data.today));
    setFoot('today-foot', delta(data.today_delta_percent, 'on yesterday'));

    $('[data-kpi="week"]').text(count(data.this_week));
    setFoot('week-foot', data.week_target ? 'Target ' + count(data.week_target) : '');

    $('[data-kpi="month"]').text(count(data.this_month));
    setFoot(
      'month-foot',
      data.highest_month ? 'All-time high ' + count(data.highest_month.value) : ''
    );

    $('[data-kpi="lifetime"]').text(count(data.lifetime));
    setFoot('lifetime-foot', data.since ? 'Since ' + data.since : '');
  }

  /**
   * Grouped bars, drawn in CSS.
   *
   * Heights are a percentage of the tallest day rather than an absolute scale, so a quiet
   * week still reads as a shape instead of a flat line at the bottom of the panel.
   */
  function renderChart(series) {
    const $chart = $('#chart').empty();

    if (!series.length) {
      $chart.append(
        $('<p class="empty-state"></p>').text('No AI events recorded in this period yet.')
      );
      return;
    }

    const peak = Math.max(
      1,
      ...series.map(function (d) {
        return (d.completed || 0) + (d.pending || 0);
      })
    );

    series.forEach(function (day) {
      const completed = ((day.completed || 0) / peak) * 100;
      const pending = ((day.pending || 0) / peak) * 100;

      $('<div class="chart__col"></div>')
        .append(
          $('<div class="chart__bars"></div>')
            .append(
              $('<div class="chart__bar chart__bar--completed"></div>')
                .css('height', completed + '%')
                .attr('title', day.label + ': ' + count(day.completed) + ' completed')
            )
            .append(
              $('<div class="chart__bar chart__bar--pending"></div>')
                .css('height', pending + '%')
                .attr('title', day.label + ': ' + count(day.pending) + ' pending payment')
            )
        )
        .append($('<span class="chart__label"></span>').text(day.short_label || day.label))
        .appendTo($chart);
    });
  }

  function renderException(key, payload) {
    $('[data-count="' + key + '"]').text(count(payload.count));

    const $rows = $('[data-rows="' + key + '"]').empty();
    if (!payload.rows || !payload.rows.length) {
      $rows.append($('<p class="exception__meta"></p>').text('Nothing needs attention.'));
      return;
    }

    payload.rows.forEach(function (row) {
      $('<div class="exception__row"></div>')
        .append($('<p class="exception__label"></p>').text(row.label))
        .append(
          $('<p class="exception__meta"></p>')
            .addClass(row.severity === 'error' ? 'exception__meta--error' : '')
            .text(row.meta)
        )
        .appendTo($rows);
    });
  }

  function renderExceptions(data) {
    const total =
      (data.pending_payments || {}).count +
      (data.failed_otps || {}).count +
      (data.low_stock || {}).count +
      (data.stale_indents || {}).count;

    MaitAI.shell.setExceptionCount(total);

    renderException('pending-payments', data.pending_payments || {});
    renderException('failed-otps', data.failed_otps || {});
    renderException('low-stock', data.low_stock || {});
    renderException('stale-indents', data.stale_indents || {});
  }

  // ------------------------------------------------------------------------------------
  // Load
  // ------------------------------------------------------------------------------------
  function load(days) {
    api
      .dashboardSummary()
      .done(function (data) {
        renderSummary(data);
        renderExceptions(data.exceptions || {});
      })
      .fail(showError);

    api
      .dashboardTrends({ granularity: 'daily', days: days })
      .done(function (data) {
        renderChart(data.results || []);
      })
      .fail(showError);
  }

  $(function () {
    // No session, no dashboard. Done before any request so the page does not flash a
    // half-rendered shell on the way to the login screen.
    if (!MaitAI.shell.requireSession()) {
      return;
    }
    MaitAI.shell.mount();

    $('#today-date').text(
      new Date().toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    );

    api.me().fail(function () {
      // A stale token that the refresh could not rescue. api.js has already cleared it.
      window.location.replace('login.html');
    });

    load(Number($('#range').val()));

    $('#range').on('change', function () {
      load(Number($(this).val()));
    });

    $('#export').on('click', function () {
      // The reports screen builds the query and streams the file with the bearer token
      // attached; a bare link here would arrive unauthenticated.
      window.location.href = 'reports.html';
    });
  });
})(jQuery, window.MaitAI);
