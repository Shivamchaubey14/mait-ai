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
      // The tile's own foot tones (portal.css), not a pair of names only this page knows:
      // the cards are the shared stat tile, so the colour on them is the shared one.
      className: up ? 'tile__foot--good' : 'tile__foot--bad',
    };
  }

  function setFoot(selector, value) {
    const $el = $('[data-kpi="' + selector + '"]').removeClass('tile__foot--good tile__foot--bad');
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

    renderRate(data.pregnancy || {});
  }

  /**
   * Conception rate.
   *
   * Null and zero are different answers. 0.0% is a platform whose inseminations are failing;
   * no rate at all is a platform whose first checks are not due yet — ninety days after the
   * straw — and rendering the two the same way raises a false alarm on a portal in its first
   * quarter. So an em dash and a line saying why, rather than a red zero.
   */
  function renderRate(pregnancy) {
    const percent = pregnancy.conception_rate;
    const known = typeof percent === 'number';

    $('[data-kpi="rate"]').text(known ? percent.toFixed(1) + '%' : '—');
    setFoot(
      'rate-foot',
      known
        ? count(pregnancy.conceived) + ' of ' + count(pregnancy.decided) + ' settled'
        : 'No insemination has an answer yet'
    );
  }

  // Breathing room between the top of a day's bars and the readout describing them.
  const TIP_GAP = 10;

  /**
   * The reading for one day, in the order the legend lists it.
   *
   * One function so the tooltip, the accessible name and any future export cannot drift into
   * describing the same bar differently.
   */
  function dayHeading(day) {
    return day.short_label ? day.short_label + ', ' + day.label : day.label;
  }

  function daySummary(day) {
    return (
      dayHeading(day) +
      ': ' +
      count(day.completed || 0) +
      ' completed, ' +
      count(day.pending || 0) +
      ' pending payment'
    );
  }

  /**
   * Hover readout.
   *
   * The bars carried a `title` attribute, which is the browser's tooltip: a second of delay
   * before it appears, no styling, and — the reason it was never actually usable here — it
   * only fires over the bar itself. A quiet day is a two-pixel sliver, and the days worth
   * asking about are exactly the ones too short to hit with a pointer.
   *
   * So the whole column is the target, it reads both series at once rather than whichever
   * one the pointer happened to land on, and it answers to keyboard focus as well.
   */
  function positionTip($chart, $tip, $col) {
    const chartWidth = $chart.outerWidth();
    const chartHeight = $chart.outerHeight();
    const tipWidth = $tip.outerWidth();
    const centre = $col.position().left + $col.outerWidth() / 2;

    // Clamped to the panel on both axes: the first and last columns sit against the edges,
    // and the tallest one reaches the ceiling. A readout that hangs off the side of the card
    // is one nobody can finish reading.
    const left = Math.max(0, Math.min(chartWidth - tipWidth, centre - tipWidth / 2));

    // Sits just above the top of that day's stack, so it points at what it is describing
    // rather than floating at a fixed height. Measured from the drawn baseline rather than
    // assumed, because the column also holds the date label underneath.
    const $bars = $col.find('.chart__bars');
    const baseline = chartHeight - ($bars.position().top + $bars.outerHeight());
    const stackTop = baseline + $bars.outerHeight() * ($col.data('stack') || 0);
    const bottom = Math.max(0, Math.min(stackTop + TIP_GAP, chartHeight - $tip.outerHeight()));

    $tip.css({ left: left + 'px', bottom: bottom + 'px' });
  }

  function showTip($chart, $tip, $col, day) {
    $tip.empty();
    $tip.append($('<p class="chart__tip-day"></p>').text(dayHeading(day)));

    [
      { name: 'Completed', value: day.completed || 0, className: 'is-completed' },
      { name: 'Pending payment', value: day.pending || 0, className: 'is-pending' },
    ].forEach(function (row) {
      $('<p class="chart__tip-row"></p>')
        .addClass(row.className)
        .append($('<span class="chart__tip-name"></span>').text(row.name))
        .append($('<span class="chart__tip-value"></span>').text(count(row.value)))
        .appendTo($tip);
    });

    $chart.find('.chart__col--active').removeClass('chart__col--active');
    $col.addClass('chart__col--active');

    // Shown before measuring: a hidden element has no width to centre on.
    $tip.addClass('is-visible');
    positionTip($chart, $tip, $col);
  }

  function hideTip($chart, $tip) {
    $tip.removeClass('is-visible');
    $chart.find('.chart__col--active').removeClass('chart__col--active');
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

    const $tip = $('<div class="chart__tip" role="status" aria-live="polite"></div>');

    series.forEach(function (day) {
      const $bars = $('<div class="chart__bars"></div>');

      // A zero draws no bar at all. `min-height` gave every empty day a sliver of both
      // colours, which reads as "one or two" from across a desk — the one number a dashboard
      // must never round up.
      [
        { value: day.completed || 0, className: 'chart__bar--completed' },
        { value: day.pending || 0, className: 'chart__bar--pending' },
      ].forEach(function (bar) {
        const $bar = $('<div class="chart__bar"></div>').addClass(bar.className);
        if (bar.value > 0) {
          $bar.css('height', (bar.value / peak) * 100 + '%').addClass('chart__bar--drawn');
        }
        $bars.append($bar);
      });

      $('<div class="chart__col"></div>')
        // Focusable and named, so the reading is available without a pointer at all. The
        // group is the unit that means something; the two bars inside it are decoration.
        .attr({ tabindex: '0', role: 'img', 'aria-label': daySummary(day) })
        .data('day', day)
        .data('stack', ((day.completed || 0) + (day.pending || 0)) / peak)
        .append($bars)
        .append($('<span class="chart__label"></span>').text(day.short_label || day.label))
        .appendTo($chart);
    });

    $chart.append($tip);

    // Namespaced and unbound first. The panel is re-rendered whenever the range changes, and
    // `empty()` clears the columns but not the handlers delegated from the container they
    // hung off — without this, a morning of changing the range stacks up a set per render.
    $chart
      .off('.charttip')
      .on('mouseenter.charttip focusin.charttip', '.chart__col', function () {
        showTip($chart, $tip, $(this), $(this).data('day'));
      })
      .on('mouseleave.charttip focusout.charttip', '.chart__col', function () {
        hideTip($chart, $tip);
      });
  }

  function renderException(key, payload) {
    $('[data-count="' + key + '"]').text(count(payload.count));
    MaitAI.ui.queueLink(key, payload.count);

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

  const QUEUES = {
    'pending-payments': 'pending_payments',
    'failed-otps': 'failed_otps',
    'low-stock': 'low_stock',
    'stale-indents': 'stale_indents',
    'overdue-checks': 'overdue_checks',
    'declined-checks': 'declined_checks',
  };

  function renderExceptions(data) {
    let total = 0;

    // Summed from the same list the cards are drawn from. Adding a queue used to mean editing
    // an addition here as well, and the badge quietly kept counting four of five.
    Object.keys(QUEUES).forEach(function (name) {
      const queue = data[QUEUES[name]] || {};
      total += queue.count || 0;
      renderException(name, queue);
    });

    MaitAI.shell.setExceptionCount(total);
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
    // The Failed OTPs card opens its queue over this page.
    MaitAI.otpModal.mount();

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
