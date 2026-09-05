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

  // ------------------------------------------------------------------------------------
  // Motion
  // ------------------------------------------------------------------------------------
  /**
   * The sweep across the chart, as a whole.
   *
   * A fixed per-column stagger cannot work here: the range control offers seven days and
   * ninety, and thirty milliseconds apiece would leave the last of ninety columns arriving
   * nearly three seconds after the first — long enough that somebody starts reading a chart
   * that is still drawing itself. So the budget is fixed and the columns divide it, with a
   * ceiling so that a week does not feel languid for having only seven of them.
   */
  const SWEEP_MS = 320;
  const SWEEP_MAX_STEP = 30;

  function sweepStep(columns) {
    return Math.min(SWEEP_MAX_STEP, SWEEP_MS / Math.max(1, columns - 1));
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

    // The sweep left to right, divided over however many days the range holds — see
    // `sweepStep`. Worked out once rather than per column.
    const step = sweepStep(series.length);

    series.forEach(function (day, index) {
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
          $bar
            .css('height', (bar.value / peak) * 100 + '%')
            // The delay this bar waits before growing, in milliseconds, read by the rule in
            // dashboard.css. A unitless number because `calc()` cannot multiply a bare
            // custom property by a duration without one.
            .css('--i', Math.round(index * step))
            .addClass('chart__bar--drawn');
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

    payload.rows.forEach(function (row, index) {
      $('<div class="exception__row"></div>')
        // Down the card rather than all at once, at half the stagger the cards themselves
        // use: these are inside something that has already arrived, and a second full-speed
        // cascade within it competes with the one that brought the card in.
        .css('--i', index * 30)
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
  /**
   * One reading of the whole screen.
   *
   * Returns a promise over both requests rather than handling their failures itself: the
   * loop above it needs to know whether the screen is current, and each half still renders
   * on its own the moment it lands — a trends call that times out must not hold back five
   * summary figures that arrived.
   */
  function load(days) {
    return $.when(
      api.dashboardSummary().done(function (data) {
        renderSummary(data);
        renderExceptions(data.exceptions || {});
      }),
      api.dashboardTrends({ granularity: 'daily', days: days }).done(function (data) {
        renderChart(data.results || []);
      })
    );
  }

  // ------------------------------------------------------------------------------------
  // Staying current
  // ------------------------------------------------------------------------------------
  /** The loop, once the page has mounted. Held here so the whole file can ask it to refetch. */
  let loop = null;

  /* Whether anything has ever landed. Until it has, a failure is the screen rather than a
     gap in it, and it is said out loud. */
  let loaded = false;

  /* How many beats in a row may be missed before the page says so in a banner. */
  const QUIET_MISSES = 2;

  /** What the indicator is currently showing, so its "how long ago" can keep ageing. */
  const indicator = { name: 'paused', lastOk: null };

  /** How often the indicator re-reads its own age. Text only; nothing is fetched. */
  const AGE_MS = 15000;

  let queueBound = false;

  /**
   * Whether a queue dialog is open over the page.
   *
   * The beat is held while one is. Rows behind a modal cannot be read, so refreshing them is
   * churn nobody sees — and `showModal` makes the page behind it inert, which would leave a
   * count animating in front of an operator who cannot reach it.
   */
  function queueOpen() {
    const dialog = document.getElementById('queue-modal');
    if (!dialog) {
      return false;
    }
    if (!queueBound) {
      queueBound = true;
      // The dialog is built lazily, on first open, so this is the earliest the listener can
      // be attached. Without it the screen would come back to figures as old as the dialog.
      dialog.addEventListener('close', function () {
        loop.refresh();
      });
    }
    return dialog.open;
  }

  /** How long ago, in the words somebody would actually use for it. */
  function since(date) {
    if (!date) {
      return 'not yet';
    }
    const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
    if (seconds < 45) {
      return 'just now';
    }
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
      return minutes === 1 ? 'a minute ago' : minutes + ' minutes ago';
    }
    // Past an hour the exact figure has stopped being the point. Something is wrong — a beat
    // is thirty seconds — and "over an hour ago" is the sentence that says so.
    return 'over an hour ago';
  }

  /**
   * The indicator, in the topbar beside the date.
   *
   * A screen that changes on its own has to say that it does, and say when it last managed
   * it. Without this line an operator has no way to tell a quiet morning from a dashboard
   * that stopped fetching an hour ago — and the second one is a screen actively misleading
   * somebody, because every figure on it still looks perfectly current.
   */
  function paintIndicator(name, info) {
    indicator.name = name;
    if (info && Object.prototype.hasOwnProperty.call(info, 'lastOk')) {
      indicator.lastOk = info.lastOk;
    }

    const $live = $('#live');
    if (!$live.length) {
      return;
    }

    let text;
    if (name === 'offline') {
      text = 'Offline';
    } else if (name === 'stale') {
      text = 'Reconnecting…';
    } else if (name === 'updating') {
      text = indicator.lastOk ? 'Updating…' : 'Loading…';
    } else if (name === 'paused') {
      text = 'Paused';
    } else {
      text = 'Live · ' + since(indicator.lastOk);
    }

    $live.attr('data-state', name).find('.live__text').text(text);
  }

  /**
   * A beat that did not land.
   *
   * One missed beat is a laptop lid, a wifi hop or a deploy restarting gunicorn, and covering
   * the dashboard in a red banner each time one happens is how a banner stops being read. The
   * indicator has already gone amber, which is the honest amount to say about it.
   *
   * Two in a row is something worth interrupting for. So is the very first load, whatever the
   * count — there are no figures behind the banner for the operator to go on looking at.
   */
  function reportMiss(problem, misses) {
    if (!loaded || misses >= QUIET_MISSES) {
      showError(problem);
    }
  }

  $(function () {
    // No session, no dashboard. Done before any request so the page does not flash a
    // half-rendered shell on the way to the login screen.
    if (!MaitAI.shell.requireSession()) {
      return;
    }
    MaitAI.shell.mount();
    // Every card opens its own queue over this page.
    MaitAI.queueModal.mount();

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

    loop = MaitAI.live.create({
      // Read at the moment of the beat, not captured: the range control changes underneath
      // this loop, and a closure over the value it held at mount would keep fetching the
      // week an operator stopped looking at twenty minutes ago.
      request: function () {
        return load(Number($('#range').val()));
      },
      held: queueOpen,
      onFail: reportMiss,
      onState: function (name, info) {
        if (name === 'live') {
          loaded = true;
          // Whatever the last failure put on screen is no longer true. Cleared on the way
          // back rather than left for somebody to dismiss — an alert about a request that
          // has since succeeded is an alert that teaches people to close alerts unread.
          MaitAI.shell.clearAlert();
        }
        paintIndicator(name, info);
      },
    });

    // The first load goes through the loop as well, rather than being a separate call before
    // it. One path means there is no window in which the page has data the loop thinks it has
    // not fetched, and the first failure is reported by the same code as every later one.
    loop.start().refresh();

    // The figures age whether or not anything is fetched, so the line that says how old they
    // are has to be rewritten as they do. Text only, and skipped in a background tab, where
    // there is nobody to read it and the beat is stopped anyway.
    window.setInterval(function () {
      if (!document.hidden && indicator.name === 'live') {
        paintIndicator('live');
      }
    }, AGE_MS);

    $('#live').on('click', function () {
      loop.refresh();
    });

    $('#range').on('change', function () {
      // Through the loop rather than a bare `load`, so the beat restarts from this moment.
      // Otherwise a poll already due a second from now would repeat the same request and
      // land a second answer on a chart that is still drawing the first.
      loop.refresh();
    });

    $('#export').on('click', function () {
      // The reports screen builds the query and streams the file with the bearer token
      // attached; a bare link here would arrive unauthenticated.
      window.location.href = 'reports.html';
    });
  });
})(jQuery, window.MaitAI);
