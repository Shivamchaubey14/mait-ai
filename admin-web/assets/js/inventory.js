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
        // Right-aligned, because the quantities under them are. A left-aligned header over a
        // right-aligned column is what makes a table look broken.
        state.breeds
          .map(function (breed) {
            return '<th class="table__num" scope="col">' + ui.escapeHtml(breed) + '</th>';
          })
          .join('') +
        '<th class="table__num" scope="col">Total</th>' +
        '<th scope="col">Status</th>' +
        '<th scope="col">Holding</th>'
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
      ' data-mait="' +
      holder.mait_id +
      '">' +
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
      '<td><button class="btn" type="button" data-open="' +
      holder.mait_id +
      '">Stock</button></td>' +
      '</tr>'
    );
  }

  /* --- one Mait's holding ---------------------------------------------------------------
   * The list carries straw counts only, because that is what decides whether a Mait can
   * work. Consumables and equipment are the rest of the answer, and an admin only wants
   * them for the one Mait they are asking about.
   */

  /**
   * A glyph per card, drawn in `currentColor` like the sidebar's.
   *
   * No icon font and no sprite sheet for three shapes, and inline paths inherit the card's
   * colour for free — which is what makes the tint and the glyph agree without being told to.
   */
  const GLYPH = {
    semen: 'M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9',
    consumable: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
    asset: 'M20.2 6.8a4.5 4.5 0 0 1-6 6L7 20a2.1 2.1 0 1 1-3-3l7.2-7.2a4.5 4.5 0 0 1 6-6l-3 3 3 3z',
  };

  function glyph(kind) {
    return (
      '<span class="holding__icon">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="' +
      GLYPH[kind] +
      '" /></svg></span>'
    );
  }

  /**
   * One card. `unitOf` returns what a quantity is counted in — straws need none, because the
   * card already says so and repeating it on every row is noise.
   */
  function stockCard(kind, title, rows, unitOf, foot) {
    const total = rows.reduce(function (sum, line) {
      return sum + (Number(line.qty) || 0);
    }, 0);

    const body = rows.length
      ? rows
          .map(function (line) {
            const qty = Number(line.qty) || 0;
            const unit = unitOf(line);
            // Only straws carry a threshold: running out of them is what stops a Mait
            // working, whereas running low on gloves is a note for the next indent.
            const tone =
              kind !== 'semen'
                ? ''
                : qty === 0
                  ? ' holding__qty--out'
                  : qty <= state.threshold
                    ? ' holding__qty--low'
                    : '';
            return (
              '<div class="holding__row">' +
              '<span class="holding__name">' +
              ui.escapeHtml(line.name) +
              (unit ? '<span class="holding__unit">' + ui.escapeHtml(unit) + '</span>' : '') +
              '</span>' +
              '<span class="holding__qty' +
              tone +
              '">' +
              ui.number(qty) +
              '</span>' +
              '</div>'
            );
          })
          .join('')
      : '<p class="holding__empty">None held.</p>';

    return (
      '<section class="holding__group holding__group--' +
      kind +
      '">' +
      '<div class="holding__head">' +
      glyph(kind) +
      '<div class="holding__heading">' +
      '<p class="holding__label">' +
      ui.escapeHtml(title) +
      '</p>' +
      '<p class="holding__total">' +
      ui.number(total) +
      ' ' +
      ui.escapeHtml(foot) +
      '</p>' +
      '</div>' +
      // How many lines are behind that total, on the head rather than left to be counted.
      '<span class="holding__lines">' +
      (rows.length ? ui.number(rows.length) : '0') +
      '</span>' +
      '</div>' +
      '<div class="holding__rows">' +
      body +
      '</div>' +
      '</section>'
    );
  }

  function showHolding(maitId) {
    const holder = state.rows.filter(function (row_) {
      return row_.mait_id === maitId;
    })[0];

    $('#holding').prop('hidden', false);
    $('#holding-title').text(holder ? holder.name : 'Mait stock');
    $('#holding-count').text('');
    // Placeholders rather than an empty panel: the card keeps its shape while the request is
    // in flight, so the page does not jump when the answer lands.
    $('#holding-body').html('<div class="holding__skeleton"></div>'.repeat(3));
    $('#holding')[0].scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    MaitAI.api
      .maitInventory(maitId)
      .done(function (data) {
        const breeds = Object.keys(data.by_breed || {}).sort();

        $('#holding-title').text(data.mait_name + ' · ' + data.sahayak_vendor_code);
        // Straws first and in words: it is the number that decides whether this Mait can
        // work at all, and the pills beside it only qualify it.
        $('#holding-count').html(
          ui.number(data.total_straws) +
            ' straws · ' +
            statusFor(data.total_straws) +
            ' ' +
            ui.pill(breeds.length + ' breeds', breeds.length ? 'info' : null)
        );

        $('#holding-body').html(
          stockCard(
            'semen',
            'Semen straws',
            breeds.map(function (breed) {
              return { name: breed, qty: data.by_breed[breed] };
            }),
            function () {
              return '';
            },
            'straws'
          ) +
            stockCard(
              'consumable',
              'Consumables',
              data.consumables || [],
              function (line) {
                return line.unit || '';
              },
              'units'
            ) +
            stockCard(
              'asset',
              'Equipment',
              data.assets || [],
              function (line) {
                return line.unit || '';
              },
              'items'
            )
        );
      })
      .fail(function (problem) {
        $('#holding-count').text('');
        $('#holding-body').html(
          '<p class="holding__error">' + ui.escapeHtml(problem.detail) + '</p>'
        );
      });
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

  /**
   * The store shelves in reach — each depot, the centres it serves, and what it holds.
   *
   * Straws and set-aside are counted separately because they answer different questions: the
   * shelf is what the store has, and set-aside is the part already promised to a Mait who has
   * not typed their code. A store showing 40 with 40 set aside has nothing left to give.
   */
  function storeRow(store) {
    const shelf = (store.lines || []).length
      ? store.lines
          .map(function (line) {
            return ui.number(line.on_hand) + ' ' + ui.escapeHtml(line.item_name);
          })
          .join(' · ')
      : '<span class="table__sub">Nothing on the shelf</span>';
    const serves = (store.plant_names || []).length
      ? store.plant_names
          .map(function (name) {
            return '<span class="chip chip--static">' + ui.escapeHtml(name) + '</span>';
          })
          .join(' ')
      : '<span class="table__sub">No BMC/MCC yet</span>';
    return (
      '<tr>' +
      '<td>' +
      ui.identity(store.name, store.code + (store.zone_name ? ' · ' + store.zone_name : '')) +
      '</td>' +
      '<td>' +
      serves +
      '</td>' +
      '<td><span class="store-shelf">' +
      shelf +
      '</span></td>' +
      '<td class="table__num">' +
      ui.number(store.straws_on_hand) +
      '</td>' +
      '<td class="table__num">' +
      (store.straws_set_aside
        ? ui.number(store.straws_set_aside)
        : '<span class="table__sub">none</span>') +
      '</td>' +
      '<td class="table__num">' +
      (store.open_indents
        ? '<a href="indents.html?status=approved">' + ui.number(store.open_indents) + '</a>'
        : '<span class="table__sub">none</span>') +
      '</td>' +
      '</tr>'
    );
  }

  function renderStores(stores) {
    $('#stores-panel').prop('hidden', false);
    $('#stores-count').text(stores.length + (stores.length === 1 ? ' store' : ' stores'));
    ui.rows(
      $('#store-rows'),
      stores,
      storeRow,
      'No store serves this part of the network yet — set one up on the Stores screen.',
      6
    );
  }

  /** Head office's zone picker. Filled only if this account may read the zones at all. */
  function loadZones() {
    MaitAI.api.zones().done(function (zones) {
      const list = (zones.results || zones || []).filter(function (zone) {
        return zone.is_active;
      });
      if (!list.length) {
        return;
      }
      const $select = $('#filter-zone');
      list.forEach(function (zone) {
        $select.append($('<option></option>').val(String(zone.id)).text(zone.name));
      });
      $('#zone-picker').prop('hidden', false);
    });
  }

  function render() {
    renderHead();
    ui.rows($('#rows'), visibleRows(), row, 'No Maits match that search.', state.breeds.length + 5);
  }

  function load() {
    MaitAI.shell.clearAlert();
    const zone = $('#filter-zone').val();
    MaitAI.api
      .inventoryOversight(zone ? { zone: zone } : {})
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
        const storeTotal = data.summary.stores || 0;
        $('#store-count').text(
          'on ' + ui.number(storeTotal) + (storeTotal === 1 ? ' store shelf' : ' store shelves')
        );
        $('#store-straws').text(ui.number(data.summary.store_straws || 0));
        $('#store-straws-foot').text(
          (data.summary.stores || 0) === 1
            ? 'Straws at the one depot in view'
            : 'Straws across ' + ui.number(data.summary.stores || 0) + ' depots'
        );
        renderStores(data.stores || []);

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
    loadZones();

    $('#filter-zone').on('change', function () {
      $('#holding').prop('hidden', true);
      load();
    });

    // Delegated: the table is rebuilt whenever the search or the sort changes.
    $('#rows').on('click', '[data-open]', function () {
      showHolding(Number($(this).data('open')));
    });

    $('#holding-close').on('click', function () {
      $('#holding').prop('hidden', true);
    });

    $('#search').on('input', render);

    $('#filter-low').on('click', function () {
      state.lowFirst = !state.lowFirst;
      $(this).toggleClass('is-active', state.lowFirst).attr('aria-pressed', String(state.lowFirst));
      render();
    });
  });
})(window.MaitAI, jQuery);
