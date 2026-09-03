/**
 * Mait leaderboard (W14).
 *
 * Ranked by AI count — how many inseminations each Mait actually performed — with collections
 * beside it, because the two together are the only honest reading: a high count with a low
 * cash share means events completed without money landing, which is a problem rather than a
 * performance.
 *
 * **The range is the screen's other half.** "Who is working" is only ever asked about a
 * period, and the period the office cares about is usually a month somebody is closing rather
 * than a rolling window. So the two dates are always on screen and always editable, and the
 * presets fill them in rather than replacing them — a board headed "Last 30 days" leaves the
 * reader working out which thirty, and gets read as this month by anybody in a hurry.
 *
 * Bars are scaled to the leader rather than to a target. There is no per-Mait target — the
 * villages differ by an order of magnitude in size — so the comparison that means anything is
 * against the best Mait working the same days.
 */

(function (MaitAI, $) {
  'use strict';

  const ui = MaitAI.ui;

  const state = { ranked: [], leader: 0, total: 0 };

  /** `Date` to the `YYYY-MM-DD` the API and the date inputs both want. */
  function iso(date) {
    const pad = function (n) {
      return String(n).padStart(2, '0');
    };
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  /**
   * The two dates a preset stands for, as `[from, to]`.
   *
   * "Last 30 days" includes today, which is why it counts back 29: a range of thirty days
   * ending today is today and the twenty-nine before it, and off-by-one here is a day of
   * somebody's work appearing or vanishing from a board people are judged on.
   */
  function preset(name) {
    const today = new Date();
    const days = Number(name);
    if (days) {
      const from = new Date(today);
      from.setDate(from.getDate() - (days - 1));
      return [from, today];
    }
    if (name === 'this-month') {
      return [new Date(today.getFullYear(), today.getMonth(), 1), today];
    }
    if (name === 'last-month') {
      return [
        new Date(today.getFullYear(), today.getMonth() - 1, 1),
        // Day zero of this month is the last day of the one before it, whatever its length.
        new Date(today.getFullYear(), today.getMonth(), 0),
      ];
    }
    return null;
  }

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
      // The top three are the ones anybody looks for by position, so the rank is set as a
      // figure rather than left to be counted down the column.
      '<td class="table__num">' +
      (index + 1) +
      '</td>' +
      '<td>' +
      ui.identity(entry.name, entry.sahayak_vendor_code) +
      '</td>' +
      // Same meter as the coverage table: the count in a fixed gutter, then the bar, so the
      // bars start at one x and can be compared by eye down the column.
      '<td><div class="meter">' +
      '<span class="meter__value">' +
      ui.number(entry.ai_count) +
      '</span>' +
      // Below half the leader is worth a second look, so it is coloured rather than left to
      // be worked out from bar lengths.
      ui.bar(relative, relative < 50 ? 'behind' : null) +
      '</div></td>' +
      '<td class="table__num">' +
      ui.money(entry.amount_collected) +
      '</td>' +
      '<td class="table__num">' +
      (share === null ? '—' : share + '%') +
      '</td>' +
      '</tr>'
    );
  }

  /**
   * Ranks are worked out before filtering, and carried on the row.
   *
   * A Mait searched for is still fourth in the district — renumbering the visible rows would
   * make every search result look like a winner.
   */
  function ranked(results) {
    return results.map(function (entry, index) {
      return { entry: entry, rank: index };
    });
  }

  function matching(rows) {
    const term = ($('#search').val() || '').trim().toLowerCase();
    if (!term) {
      return rows;
    }
    return rows.filter(function (item) {
      return (
        String(item.entry.name || '')
          .toLowerCase()
          .indexOf(term) >= 0 ||
        String(item.entry.sahayak_vendor_code || '')
          .toLowerCase()
          .indexOf(term) >= 0
      );
    });
  }

  function render() {
    const shown = matching(state.ranked);

    ui.rows(
      $('#rows'),
      shown,
      function (item) {
        return row(item.entry, item.rank, state.leader);
      },
      state.ranked.length
        ? 'No Mait matches that search.'
        : 'No AI events were recorded in these days.',
      5
    );

    $('#foot').text(
      state.ranked.length
        ? 'Bars are relative to the leading Mait. Yellow marks anyone below half of them.' +
            // Said only when it is true. The board is capped, and a capped board that does
            // not say so presents its last row as the bottom of the roster.
            (state.total > state.ranked.length
              ? ' Showing the top ' +
                ui.number(state.ranked.length) +
                ' of ' +
                ui.number(state.total) +
                ' Maits who worked.'
              : '')
        : ''
    );
  }

  /** "1 Aug – 31 Aug 2026", or a single day where the range is one. */
  function rangeLabel(from, to) {
    if (from === to) {
      return ui.date(from);
    }
    return ui.date(from) + ' – ' + ui.date(to);
  }

  function drawTiles(data) {
    const totals = data.totals || {};
    const days = data.days || 1;
    const count = Number(totals.ai_count) || 0;

    $('[data-kpi="ai"]').text(ui.number(count));
    $('[data-kpi="ai-foot"]').text(
      days === 1 ? 'on this day' : 'across ' + ui.number(days) + ' days'
    );

    $('[data-kpi="maits"]').text(ui.number(data.count));
    // Nobody working is a different fact from nobody being on the roster, and the board below
    // says the same thing in more words. Kept short here.
    $('[data-kpi="maits-foot"]').text(
      data.count ? 'recorded at least one AI' : 'nobody recorded an AI'
    );

    $('[data-kpi="collected"]').text(ui.money(totals.amount_collected));
    const collected = Number(totals.amount_collected) || 0;
    const cod = Number(totals.cod_amount) || 0;
    $('[data-kpi="collected-foot"]').text(
      collected ? Math.round((cod / collected) * 100) + '% of it in cash' : 'nothing collected'
    );

    // Across every calendar day in the range, Sundays included — which is what makes it
    // comparable between two ranges of different lengths, and the reason the foot says so
    // rather than leaving "a day" to be read as a working day. Rounded to one place, because
    // "6.5 a day" is a figure somebody repeats and "6.5333" is not.
    const perDay = days ? Math.round((count / days) * 10) / 10 : 0;
    $('[data-kpi="average"]').text(count ? perDay : '—');
    $('[data-kpi="average-foot"]').text(
      count ? 'AI per calendar day in the range' : 'no work in this range'
    );
  }

  function load() {
    MaitAI.shell.clearAlert();
    $('#rows').attr('aria-busy', 'true');

    const query = {};
    const from = $('#date-from').val();
    const to = $('#date-to').val();
    if (from) {
      query.date_from = from;
    }
    if (to) {
      query.date_to = to;
    }

    MaitAI.api
      .maitPerformance(query)
      .done(function (data) {
        // Echoed back rather than assumed: the API clamps a range to what it can answer for —
        // a date in the future, a span longer than a year — and the screen has to say what it
        // actually counted rather than what was typed.
        $('#date-from').val(data.date_from);
        $('#date-to').val(data.date_to);
        // The two fields on screen are `controls.js` replacements, and writing to the native
        // input behind one does not repaint it — so without this the range was set, correct
        // and invisible, both pickers still reading "dd-mm-yyyy". Not a `change` trigger:
        // that re-enters the handler below, which reloads, which lands back here.
        if (MaitAI.controls) {
          MaitAI.controls.sync('#date-from, #date-to');
        }
        $('#period-label').text(rangeLabel(data.date_from, data.date_to));

        const results = data.results || [];
        state.leader = results.length ? results[0].ai_count : 0;
        state.total = data.count || 0;
        state.ranked = ranked(results);

        drawTiles(data);
        render();
      })
      .fail(function (problem) {
        MaitAI.shell.alert(problem.detail);
        ui.rows($('#rows'), [], null, 'Could not load the leaderboard.', 5);
      });
  }

  /** Fill the two dates from a preset and reload. */
  function applyPreset(name) {
    const range = preset(name);
    if (!range) {
      return;
    }
    $('#date-from').val(iso(range[0]));
    $('#date-to').val(iso(range[1]));
    load();
  }

  $(function () {
    if (!MaitAI.shell.requireSession()) {
      return;
    }
    MaitAI.shell.mount();
    applyPreset($('#period').val());

    $('#period').on('change', function () {
      applyPreset($(this).val());
    });

    // Typing a date is choosing a range of your own, so the preset above stops claiming to
    // describe it. `controls.js` replaces these fields with its own calendar and writes back
    // to the native input, which is what this listens to.
    $('#date-from, #date-to').on('change', function () {
      // The preset above stops claiming to describe a range somebody has typed over. Repainted
      // rather than `.trigger('change')`, which would re-enter this same handler.
      $('#period').val('custom');
      if (MaitAI.controls) {
        MaitAI.controls.sync('#period');
      }
      load();
    });

    // Filtered on the rows already fetched: the board is a few hundred at most, and the
    // ranking has to be worked out across all of them anyway.
    $('#search').on('input', render);
  });
})(window.MaitAI, jQuery);
