/**
 * Dashboard page (SRS §6.7.1–6.7.3, §6.7.6).
 *
 * Reads pre-aggregated endpoints only. Never ask the API to compute over raw events from
 * here — the §7 target is a P95 under 400 ms, and the aggregation tables exist for exactly
 * this page.
 */

/* global jQuery, Chart, MaitAI */
(function ($, MaitAI) {
  'use strict';

  const api = MaitAI.api;
  let trendChart = null;

  function showError(problem) {
    $('#alert-region').html(
      $('<div class="alert alert--error"></div>').text(MaitAI.api.problemToLines(problem)[0])
    );
  }

  function formatCount(value) {
    return typeof value === 'number' ? value.toLocaleString('en-IN') : '—';
  }

  function renderSummary(data) {
    $('[data-kpi="today"]').text(formatCount(data.today));
    $('[data-kpi="week"]').text(formatCount(data.this_week));
    $('[data-kpi="month"]').text(formatCount(data.this_month));
    $('[data-kpi="lifetime"]').text(formatCount(data.lifetime));

    // Current month vs the same day last month (SRS §6.7.1) — a raw month-to-date total
    // compared against a full previous month would always look like a collapse.
    if (typeof data.month_delta_percent === 'number') {
      const up = data.month_delta_percent >= 0;
      $('[data-kpi="month-delta"]')
        .removeClass('kpi-delta--up kpi-delta--down')
        .addClass(up ? 'kpi-delta--up' : 'kpi-delta--down')
        .text(
          (up ? '▲ ' : '▼ ') +
            Math.abs(data.month_delta_percent).toFixed(1) +
            '% vs same day last month'
        );
    }

    $('[data-kpi="highest-day"]').text(formatCount(data.highest_day && data.highest_day.value));
    $('[data-kpi="highest-day-on"]').text((data.highest_day && data.highest_day.label) || '');
    $('[data-kpi="highest-month"]').text(
      formatCount(data.highest_month && data.highest_month.value)
    );
    $('[data-kpi="highest-month-on"]').text(
      (data.highest_month && data.highest_month.label) || ''
    );
  }

  function renderTrend(series) {
    const canvas = document.getElementById('trend-chart');
    if (!canvas || typeof Chart === 'undefined') {
      return;
    }

    // Read the palette from the tokens rather than repeating hex values here — the CI
    // colour check would reject them, and rightly so.
    const styles = getComputedStyle(document.documentElement);
    const primary = styles.getPropertyValue('--chart-1').trim();

    if (trendChart) {
      trendChart.destroy();
    }

    trendChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: series.map(function (point) {
          return point.date;
        }),
        datasets: [
          {
            label: 'AI events',
            data: series.map(function (point) {
              return point.count;
            }),
            borderColor: primary,
            backgroundColor: primary,
            tension: 0.3,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
      },
    });
  }

  function renderExceptions(data) {
    const rows = [
      { label: 'Pending payments', count: data.pending_payments, href: 'ai-events.html?status=payment_pending' },
      { label: 'Failed OTP verifications', count: data.failed_otps, href: 'ai-events.html?otp=failed' },
      { label: 'Maits low on stock', count: data.low_stock_maits, href: 'inventory.html?low=1' },
      { label: 'Stale indents', count: data.stale_indents, href: 'indents.html?stale=1' },
    ];

    const $body = $('#exceptions-body').empty();
    const actionable = rows.filter(function (row) {
      return row.count > 0;
    });

    if (!actionable.length) {
      $body.append('<tr><td colspan="3" class="empty-state">Nothing needs attention.</td></tr>');
      return;
    }

    actionable.forEach(function (row) {
      $('<tr></tr>')
        .append($('<td></td>').text(row.label))
        .append($('<td></td>').append($('<span class="badge badge--pending"></span>').text(row.count)))
        .append($('<td></td>').append($('<a class="btn btn--ghost">View</a>').attr('href', row.href)))
        .appendTo($body);
    });
  }

  $(function () {
    api
      .me()
      .done(function (user) {
        $('#current-user').text(user.full_name + ' · ' + user.role);
      })
      .fail(showError);

    api.dashboardSummary().done(function (data) {
      renderSummary(data);
      renderExceptions(data.exceptions || {});
    }).fail(showError);

    api
      .dashboardTrends({ granularity: 'daily', days: 30 })
      .done(function (data) {
        renderTrend(data.results || []);
      })
      .fail(showError);

    $('#logout').on('click', function () {
      api.logout().always(function () {
        window.location.href = 'login.html';
      });
    });
  });
})(jQuery, window.MaitAI);
