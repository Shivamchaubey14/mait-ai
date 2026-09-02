/**
 * Mait payment (W18).
 *
 * Preview then download, the same order Reports uses and for a stronger reason: this file is
 * a payment instruction. Somebody opens it and money moves, so the person about to send it
 * reads it on a screen first — against the rates it was built from, which are on the same
 * screen and editable there.
 *
 * The preview draws every column the workbook has, in the same order, deliberately. A preview
 * that shows a convenient subset is a preview that can agree with itself and disagree with
 * the file, and the operator has no way of knowing which they are looking at.
 *
 * Money is formatted, quantities are not. A quantity of straws is a count of objects and
 * "₹71" for seventy-one straws is the kind of thing that gets noticed a month later.
 *
 * The per-MCC deduction count is **not** on this screen, though the API still answers with it
 * and the workbook still carries it as its second tab. It is a different question for a
 * different desk — money recovered *from* members rather than paid *to* Maits — and beside a
 * payout sheet it invited exactly the reconciliation the two figures cannot support. Whoever
 * settles milk payments reads it in the file.
 */

(function (MaitAI, $) {
  'use strict';

  const ui = MaitAI.ui;
  const shell = MaitAI.shell;

  const MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  /* How many months the picker offers. Eighteen covers a full year plus the run-up, which is
     as far back as anybody re-opens a payout. */
  const MONTH_CHOICES = 18;

  /* The four material columns, in the order the office's sheet reads them, with the label
     each one carries there. `sheath` is spelled correctly here and "SHEETH" in the workbook,
     which is the office's own spelling and not ours to correct in a file they have been
     reading for years. */
  const MATERIALS = [
    ['semen', 'Semen'],
    ['ln2', 'LN2'],
    ['sheath', 'Sheath'],
    ['gloves', 'Gloves'],
  ];

  function monthLabel(value) {
    const parts = /^(\d{4})-(\d{2})$/.exec(value || '');
    if (!parts) {
      return value || '';
    }
    return MONTHS[Number(parts[2]) - 1] + ' ' + parts[1];
  }

  /**
   * The months this screen offers, newest first, starting at the current one.
   *
   * The month in progress is first and is what the screen opens on. It is not what gets paid
   * — a payment run is for a month that has finished — but it is what people are actually
   * looking for most of the time: whether today's captures landed, whether a tester's account
   * is producing rows at all. Its option says "in progress" and the sheet says so again, so
   * nobody reads a running total as a settled one.
   */
  function monthOptions() {
    const now = new Date();
    const options = [];
    for (let back = 0; back < MONTH_CHOICES; back += 1) {
      const when = new Date(now.getFullYear(), now.getMonth() - back, 1);
      const value = when.getFullYear() + '-' + String(when.getMonth() + 1).padStart(2, '0');
      options.push(
        '<option value="' +
          value +
          '">' +
          ui.escapeHtml(monthLabel(value) + (back === 0 ? ' · in progress' : '')) +
          '</option>'
      );
    }
    return options.join('');
  }

  /** A rupee figure, rounded to whole rupees — the sheet has never carried paise. */
  function money(value) {
    const number = Math.round(Number(value));
    if (isNaN(number)) {
      return '—';
    }
    return (number < 0 ? '−₹' : '₹') + Math.abs(number).toLocaleString('en-IN');
  }

  /** A count. Zero is muted rather than hidden: a blank cell reads as missing data. */
  function quantity(value) {
    const number = Number(value) || 0;
    if (!number) {
      return '<span class="payout__zero">0</span>';
    }
    return ui.escapeHtml(number.toLocaleString('en-IN'));
  }

  function row(item) {
    const negative = item.overdrawn;
    return (
      '<tr' +
      (negative ? ' class="is-blocked"' : '') +
      '>' +
      '<td class="payout__pin payout__pin--1 payout__code">' +
      item.serial +
      '</td>' +
      '<td class="payout__pin payout__pin--2">' +
      ui.escapeHtml(item.mcc_name || '—') +
      '</td>' +
      '<td class="payout__pin payout__pin--3">' +
      ui.identity(item.mait_name, item.vendor_code) +
      '</td>' +
      '<td class="table__num">' +
      quantity(item.ai_performed) +
      '</td>' +
      '<td class="table__num">' +
      money(item.commission) +
      '</td>' +
      '<td class="table__num">' +
      money(item.fixed_amount) +
      '</td>' +
      '<td class="table__num payout__rule">' +
      money(item.gross) +
      '</td>' +
      MATERIALS.map(function (material) {
        return '<td class="table__num">' + quantity(item.quantities[material[0]]) + '</td>';
      }).join('') +
      '<td class="table__num">' +
      money(item.deduction) +
      '</td>' +
      '<td class="table__num payout__rule">' +
      money(item.after_deduction) +
      '</td>' +
      '<td class="table__num">' +
      money(item.tagging) +
      '</td>' +
      '<td class="table__num payout__net' +
      (negative ? ' is-negative' : '') +
      '">' +
      money(item.net_payable) +
      '</td>' +
      // Masked, and said so by the mask itself rather than by a note somewhere. An em dash
      // where there is nothing on file at all, which is a different problem: that Mait cannot
      // be paid until somebody enters their details.
      '<td class="payout__code">' +
      (item.bank_account_no ? ui.escapeHtml(item.bank_account_no) : '—') +
      '</td>' +
      '<td class="payout__code">' +
      (item.ifsc_code ? ui.escapeHtml(item.ifsc_code) : '—') +
      '</td>' +
      '<td class="payout__code">' +
      (item.pan_no ? ui.escapeHtml(item.pan_no) : '—') +
      '</td>' +
      '<td class="payout__code">' +
      ui.escapeHtml(item.vendor_code || '—') +
      '</td>' +
      '</tr>'
    );
  }

  function totalsRow(totals) {
    const cells = [
      '<td class="payout__pin payout__pin--1"></td>',
      '<td class="payout__pin payout__pin--2"></td>',
      '<td class="payout__pin payout__pin--3">Total</td>',
      '<td class="table__num">' + ui.number(totals.ai_performed) + '</td>',
      '<td class="table__num">' + money(totals.commission) + '</td>',
      '<td class="table__num">' + money(totals.fixed_amount) + '</td>',
      '<td class="table__num payout__rule">' + money(totals.gross) + '</td>',
    ];
    MATERIALS.forEach(function (material) {
      cells.push('<td class="table__num">' + ui.number(totals.quantities[material[0]]) + '</td>');
    });
    cells.push('<td class="table__num">' + money(totals.deduction) + '</td>');
    cells.push('<td class="table__num payout__rule">' + money(totals.after_deduction) + '</td>');
    cells.push('<td class="table__num">' + money(totals.tagging) + '</td>');
    cells.push('<td class="table__num payout__net">' + money(totals.net_payable) + '</td>');
    // The four identity columns have no total, but the band should run the width of the
    // table rather than stop halfway across it.
    cells.push('<td></td><td></td><td></td><td></td>');
    return '<tr>' + cells.join('') + '</tr>';
  }

  /**
   * Tell the pinned columns where to stop.
   *
   * The three identity columns are `position: sticky`, and each needs the summed width of the
   * ones in front of it. Those widths are whatever the browser gave them — a long MCC name, a
   * different zoom, a font that loaded late — so they are measured once the rows are in place
   * rather than written into the stylesheet as numbers that were true on one machine. Get it
   * wrong and the third column parks on top of the second the moment anybody scrolls.
   */
  function pinColumns() {
    const $head = $('.payout__table thead th');
    if (!$head.length) {
      return;
    }
    const first = $head.eq(0).outerWidth();
    const second = $head.eq(1).outerWidth();
    $('.payout__table')
      .css('--pin-2', first + 'px')
      .css('--pin-3', first + second + 'px');
  }

  function drawTiles(report) {
    const totals = report.totals;
    const scheme = report.scheme;

    $('[data-kpi="ai"]').text(ui.number(totals.ai_performed));
    $('[data-kpi="ai-foot"]').text(
      'across ' + ui.number(totals.maits) + ' Maits · ' + money(scheme.commission_per_ai) + ' each'
    );

    $('[data-kpi="gross"]').text(money(totals.gross));
    $('[data-kpi="gross-foot"]').text(
      money(totals.commission) + ' commission + ' + money(totals.fixed_amount) + ' fixed'
    );

    $('[data-kpi="deduction"]').text(money(totals.deduction));
    $('[data-kpi="deduction-foot"]').text(
      ui.number(totals.quantities.semen) + ' straws and consumables issued'
    );

    $('[data-kpi="net"]').text(money(totals.net_payable));
    // A row below zero is not a payment, and the tile says how many there are rather than
    // leaving them to be found by scrolling nineteen columns of numbers.
    $('[data-kpi="net-foot"]')
      .text(
        totals.overdrawn
          ? ui.number(totals.overdrawn) +
              ' ' +
              (totals.overdrawn === 1 ? 'Mait owes' : 'Maits owe') +
              ' more than they earned'
          : (report.in_progress ? 'so far in ' : 'to be paid out for ') + monthLabel(report.month)
      )
      .toggleClass('tile__foot--bad', totals.overdrawn > 0);
  }

  function drawRates(report) {
    $('#commission').val(Number(report.scheme.commission_per_ai));
    $('#fixed').val(Number(report.scheme.monthly_fixed_amount));
    $('#threshold').val(report.scheme.fixed_min_ai);
    $('#straw-rate').val(Number(report.rates.semen));

    // Only the consumables. The straw rate is edited above, and listing it twice would leave
    // an operator guessing which of the two the report actually used.
    $('#material-rates').html(
      MATERIALS.filter(function (material) {
        return material[0] !== 'semen';
      })
        .map(function (material) {
          const rate = Number(report.rates[material[0]]) || 0;
          return (
            '<li><dfn>' +
            ui.escapeHtml(material[1]) +
            '</dfn><b' +
            (rate ? '' : ' class="is-unpriced"') +
            '>' +
            (rate ? money(rate) : 'Not priced') +
            '</b></li>'
          );
        })
        .join('')
    );

    const unpriced = MATERIALS.filter(function (material) {
      return !Number(report.rates[material[0]]);
    });
    $('#rate-state').text(
      unpriced.length ? unpriced.length + ' not priced' : 'All materials priced'
    );
  }

  function load(month) {
    shell.clearAlert();
    $('#rows').attr('aria-busy', 'true');

    MaitAI.api
      .maitPayment({ month: month })
      .done(function (report) {
        drawTiles(report);
        drawRates(report);

        // "So far" rather than a bare total while the month is still running — the same
        // figure means two different things on the 2nd and on the 30th.
        $('#sheet-count').html(
          (report.in_progress ? ui.pill('Month in progress', 'warn') + ' ' : '') +
            ui.escapeHtml(
              ui.number(report.totals.maits) +
                ' Maits · ' +
                monthLabel(report.month) +
                (report.totals.overdrawn ? ' · ' + report.totals.overdrawn + ' to check' : '')
            )
        );
        ui.rows($('#rows'), report.rows, row, 'No Maits to pay for this month.', 19);
        $('#totals')
          .prop('hidden', !report.rows.length)
          .html(report.rows.length ? totalsRow(report.totals) : '');
        // After the rows, never before: the columns have no width until there is something
        // in them, and measuring an empty table pins everything to zero.
        pinColumns();
      })
      .fail(function (problem) {
        shell.alert(problem.detail);
        ui.rows($('#rows'), [], row, 'Could not load the payment sheet.', 19);
        $('#totals').prop('hidden', true);
      });
  }

  /**
   * Fetch the workbook and hand it to the browser.
   *
   * `api.download` owns the bearer token and the blob dance; what stays here is the wording
   * of the failure, which is this screen's alone.
   */
  function exportWorkbook() {
    shell.clearAlert();
    const month = $('#month').val();

    $('#export').prop('disabled', true);
    $('#export-label').text('Preparing…');

    MaitAI.api
      .download(
        '/reports/mait-payment/export/?month=' + encodeURIComponent(month),
        'mait-payment-' + month + '.xlsx'
      )
      .catch(function () {
        shell.alert('The workbook could not be produced. Try again in a moment.');
      })
      .finally(function () {
        $('#export').prop('disabled', false);
        $('#export-label').text('Download workbook');
      });
  }

  function saveRates(event) {
    event.preventDefault();
    shell.clearAlert();

    const body = {
      commission_per_ai: $('#commission').val(),
      monthly_fixed_amount: $('#fixed').val(),
      fixed_min_ai: $('#threshold').val(),
      straw_rate: $('#straw-rate').val(),
    };

    $('#save-rates').prop('disabled', true).text('Saving…');
    MaitAI.api
      .savePayoutScheme(body)
      .done(function () {
        // Reloaded rather than patched into the table. Every row on screen was computed from
        // the figures that just changed, and leaving the old ones under a new rate card is
        // how somebody pays a month against a rate it was not built with.
        load($('#month').val());
        shell.alert('Rates saved. The sheet has been rebuilt.', 'good');
      })
      .fail(function (problem) {
        shell.alert(MaitAI.api.problemToLines(problem)[0]);
      })
      .always(function () {
        $('#save-rates').prop('disabled', false).text('Save rates');
      });
  }

  $(function () {
    if (!shell.requireSession()) {
      return;
    }
    shell.mount();

    // Populated before `controls.mount()` sees it, so the custom picker is built from the
    // real list rather than from an empty select it then has to be told about.
    $('#month').html(monthOptions());
    shell.decorate();

    load($('#month').val());

    $('#month').on('change', function () {
      load($(this).val());
    });
    $('#export').on('click', exportWorkbook);
    $('#rate-form').on('submit', saveRates);
  });
})(window.MaitAI, jQuery);
