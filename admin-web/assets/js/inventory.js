/**
 * Inventory oversight (W12).
 *
 * The only view that can answer "who is about to run out" — the Mait-facing endpoints only
 * ever report the caller's own stock, by design.
 *
 * Sorted emptiest first, because the screen is opened to decide where straws go next. A Mait
 * at zero is reported apart from one merely low: at zero they cannot record an AI event at
 * all, so it is a stopped Mait rather than a warning.
 *
 * Breed columns are built from the data rather than hardcoded — the breed list is
 * configuration and changes without a deploy (SRS §18.2).
 */

(function (MaitAI, $) {
  'use strict';

  const ui = MaitAI.ui;

  const state = { rows: [], breeds: [], threshold: 10, lowFirst: true };

  function statusFor(total) {
    if (total === 0) {
      return ui.pill('At zero', 'bad');
    }
    if (total <= state.threshold) {
      return ui.pill('Low', 'warn');
    }
    return ui.pill('OK', 'good');
  }

  function renderHead() {
    $('#head').html(
      '<th scope="col">Mait</th>' +
        '<th scope="col">MPPs</th>' +
        state.breeds
          .map(function (breed) {
            return '<th scope="col">' + ui.escapeHtml(breed) + '</th>';
          })
          .join('') +
        '<th scope="col">Total</th>' +
        '<th scope="col">Status</th>'
    );
  }

  function row(holder) {
    const cls =
      holder.total === 0
        ? ' class="is-blocked"'
        : holder.total <= state.threshold
          ? ' class="is-waiting"'
          : '';
    return (
      '<tr' +
      cls +
      '>' +
      '<td>' +
      ui.identity(holder.name, holder.sahayak_vendor_code) +
      '</td>' +
      '<td>' +
      (holder.mpp_codes.length
        ? ui.escapeHtml(holder.mpp_codes.slice(0, 2).join(', '))
        : '<span class="table__sub">None</span>') +
      '</td>' +
      state.breeds
        .map(function (breed) {
          const qty = holder.by_breed[breed] || 0;
          // A zero is written, not blanked: a blank cell reads as missing data rather than
          // as "none of this breed".
          return '<td class="table__num">' + qty + '</td>';
        })
        .join('') +
      '<td class="table__num">' +
      ui.number(holder.total) +
      '</td>' +
      '<td>' +
      statusFor(holder.total) +
      '</td>' +
      '</tr>'
    );
  }

  function visibleRows() {
    const term = ($('#search').val() || '').trim().toLowerCase();
    let rows = state.rows;

    if (term) {
      rows = rows.filter(function (holder) {
        return (
          String(holder.name).toLowerCase().indexOf(term) >= 0 ||
          String(holder.sahayak_vendor_code).toLowerCase().indexOf(term) >= 0 ||
          holder.mpp_codes.join(' ').toLowerCase().indexOf(term) >= 0
        );
      });
    }

    return state.lowFirst
      ? rows
      : rows.slice().sort(function (a, b) {
          return String(a.name).localeCompare(String(b.name));
        });
  }

  function render() {
    renderHead();
    ui.rows($('#rows'), visibleRows(), row, 'No Maits match that search.', state.breeds.length + 4);
  }

  function load() {
    MaitAI.shell.clearAlert();
    MaitAI.api
      .inventoryOversight()
      .done(function (data) {
        // The server already returns them emptiest first.
        state.rows = data.results || [];
        state.threshold = data.summary.low_stock_threshold;

        const breeds = {};
        state.rows.forEach(function (holder) {
          Object.keys(holder.by_breed).forEach(function (breed) {
            breeds[breed] = true;
          });
        });
        state.breeds = Object.keys(breeds).sort();

        $('#total').text(ui.number(data.summary.total_straws));
        $('#low').text(ui.number(data.summary.low));
        $('#low-foot').text('At or under ' + data.summary.low_stock_threshold + ' straws');
        $('#zero').text(ui.number(data.summary.at_zero));
        $('#breeds').text(ui.number(state.breeds.length));
        $('#mait-count').text(ui.number(data.summary.maits));

        render();
      })
      .fail(function (problem) {
        MaitAI.shell.alert(problem.detail);
        ui.rows($('#rows'), [], row, 'Could not load stock.', 4);
      });
  }

  $(function () {
    if (!MaitAI.shell.requireSession()) {
      return;
    }
    MaitAI.shell.mount();
    load();

    $('#search').on('input', render);

    $('#filter-low').on('click', function () {
      state.lowFirst = !state.lowFirst;
      $(this).toggleClass('is-active', state.lowFirst).attr('aria-pressed', String(state.lowFirst));
      render();
    });
  });
})(window.MaitAI, jQuery);
