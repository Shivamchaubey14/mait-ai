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

  const state = {
    rows: [],
    breeds: [],
    threshold: 10,
    lowFirst: true,
    // The add-stock form's own world: which Mait is open, what it can be credited with, what
    // it already holds (so the preview can say 3 → 13), and which kind is chosen right now.
    add: {
      maitId: null,
      maitName: '',
      catalogue: { breeds: [], products: [] },
      heldStraws: {},
      heldItems: {},
      // What the Mait actually holds, split by kind — the pool a removal picks from, since you
      // cannot take off what is not there. Built in openAddForm from the loaded stock.
      heldByKind: { straw: [], consumable: [], asset: [] },
      kind: 'straw',
      // 'add' credits stock, 'remove' takes it off. The one form does both.
      dir: 'add',
    },
  };

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
    // The add-stock form stays out of the way until the stock it adds to has loaded — it has
    // nothing to offer until the catalogue and the held counts are in hand.
    $('#holding-add').prop('hidden', true);
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

        openAddForm(data);
      })
      .fail(function (problem) {
        $('#holding-count').text('');
        $('#holding-body').html(
          '<p class="holding__error">' + ui.escapeHtml(problem.detail) + '</p>'
        );
      });
  }

  /* --- adding stock to a Mait ------------------------------------------------------------
   * A manual credit, the one the oversight screen needs for stock that never came through an
   * indent. The item is chosen the way the store shelf is stocked — kind, then item, then a
   * number — and a sentence says what saving will do before the button is pressed.
   */

  /** The three kinds, each in the tone and glyph the store shelf uses, so they read the same. */
  const KINDS = {
    straw: {
      label: 'Straws',
      tone: 'info',
      icon: '<path d="m18 2 4 4M17 7l3-3M19 9 8.7 19.3c-1 1-2.5 1-3.4 0l-.6-.6c-1-1-1-2.5 0-3.4L15 5M9 11l4 4M5 19l-3 3M14 4l6 6" />',
    },
    consumable: {
      label: 'Consumables',
      tone: 'good',
      icon: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3M7.5 15h9" />',
    },
    asset: {
      label: 'Equipment',
      tone: 'warn',
      icon: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z" />',
    },
  };

  function kindGlyph(kind) {
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round">' +
      KINDS[kind].icon +
      '</svg>'
    );
  }

  /**
   * What the chosen kind offers for the current direction.
   *
   * Adding draws from the whole catalogue — the point is to credit stock a Mait may not hold
   * yet. Removing draws only from what they actually hold, because taking off what is not there
   * is not a thing the form should let anyone try.
   */
  function addItemsOf(kind) {
    if (state.add.dir === 'remove') {
      return state.add.heldByKind[kind] || [];
    }
    const catalogue = state.add.catalogue;
    if (kind === 'straw') {
      return (catalogue.breeds || []).map(function (breed) {
        return {
          key: 'straw:' + breed.code,
          code: breed.code,
          name: breed.name,
          group: breed.animal_type === 'BUFF' ? 'Buffalo' : 'Cow',
        };
      });
    }
    return (catalogue.products || [])
      .filter(function (product) {
        return product.category === kind;
      })
      .map(function (product) {
        return {
          key: 'consumable:' + product.id,
          code: product.code,
          name: product.name,
          unit: product.unit,
        };
      });
  }

  /** The item behind the chosen dropdown value, whichever kind it belongs to. */
  function addItemByKey(key) {
    if (!key) {
      return null;
    }
    // A breed is only ever under straws; a product can be matched whatever kind is showing.
    const pools = key.indexOf('straw:') === 0 ? ['straw'] : ['consumable', 'asset'];
    for (let i = 0; i < pools.length; i += 1) {
      const found = addItemsOf(pools[i]).filter(function (item) {
        return item.key === key;
      })[0];
      if (found) {
        return found;
      }
    }
    return null;
  }

  /** How many of the chosen item the Mait already holds, so the preview can read 3 → 13. */
  function heldQtyFor(item) {
    if (!item) {
      return 0;
    }
    if (item.key.indexOf('straw:') === 0) {
      return state.add.heldStraws[item.code] || 0;
    }
    return state.add.heldItems[item.code] || 0;
  }

  function renderAddKinds() {
    $('#add-kinds').html(
      Object.keys(KINDS)
        .map(function (kind) {
          const count = addItemsOf(kind).length;
          return (
            '<button type="button" role="radio" aria-checked="' +
            (kind === state.add.kind) +
            '" class="stock-kind stock-kind--' +
            KINDS[kind].tone +
            (kind === state.add.kind ? ' is-on' : '') +
            '" data-kind="' +
            kind +
            '"' +
            (count ? '' : ' disabled') +
            '>' +
            '<span class="stock-kind__icon" aria-hidden="true">' +
            kindGlyph(kind) +
            '</span>' +
            '<span class="stock-kind__name">' +
            KINDS[kind].label +
            '</span>' +
            '<span class="stock-kind__count">' +
            count +
            '</span>' +
            '</button>'
          );
        })
        .join('')
    );
  }

  /**
   * Fill the item dropdown for the chosen kind.
   *
   * The animal rides in the label rather than an `<optgroup>`: controls.js draws its own flat
   * menu over the native select, and a heading would silently vanish from it. `change` is
   * triggered so that drawn menu repaints to the value set here.
   */
  function fillAddItems(keep) {
    const items = addItemsOf(state.add.kind);
    const $item = $('#add-item').empty();
    $item.append($('<option></option>').val('').text('Pick the item'));
    items.forEach(function (entry) {
      $item.append(
        $('<option></option>')
          .val(entry.key)
          .text(
            entry.name +
              (entry.group ? ' · ' + entry.group : '') +
              (entry.unit ? ' (' + entry.unit + ')' : '')
          )
      );
    });
    const known = items.some(function (entry) {
      return entry.key === keep;
    });
    $item.val(keep && known ? keep : '').trigger('change');
  }

  function setAddKind(kind) {
    state.add.kind = kind;
    renderAddKinds();
    fillAddItems('');
    renderAddPreview();
  }

  /** What saving will do, in one sentence, before the button is pressed — for either direction. */
  function renderAddPreview() {
    const removing = state.add.dir === 'remove';
    const key = $('#add-item').val();
    const item = addItemByKey(key);
    const raw = ($('#add-qty').val() || '').trim();
    const qty = raw === '' ? null : Number(raw);
    const now = heldQtyFor(item);
    const name = item ? $('#add-item option:selected').text() : '';

    $('#add-item-hint').text(
      item
        ? now
          ? ui.number(now) + ' held now'
          : removing
            ? 'None of this held — nothing to remove'
            : 'None of this held yet'
        : removing
          ? 'Pick what is being removed'
          : 'Pick what is being added'
    );

    // Remove works on the *new quantity*, not an amount to take off: the field is prefilled with
    // what the Mait holds (the original value), and the operator edits it down. Add works on an
    // amount, the way it always has. So the number in the box means different things, and the
    // preview reads it accordingly.
    let tone = 'quiet';
    let text = removing
      ? item
        ? 'Set the new quantity below what is held, and this says what removing will do.'
        : 'Pick what is being removed, and its current quantity appears to edit down.'
      : 'Pick the item and the number, and this says what saving will do.';
    let ok = false;
    if (item && qty !== null && !isNaN(qty)) {
      if (Math.floor(qty) !== qty || qty < 0) {
        tone = 'bad';
        text = removing ? 'A whole number, zero or more.' : 'A whole number of at least one, please.';
      } else if (removing) {
        if (qty > now) {
          tone = 'bad';
          text =
            'They hold only ' +
            ui.number(now) +
            '. To add more, switch to Add stock.';
        } else if (qty === now) {
          tone = 'quiet';
          text = 'That is the quantity already held — nothing to change.';
        } else {
          tone = 'take';
          ok = true;
          text =
            '<strong>' +
            ui.escapeHtml(name) +
            '</strong>: ' +
            ui.number(now) +
            ' → <strong>' +
            ui.number(qty) +
            '</strong> held (−' +
            ui.number(now - qty) +
            ')';
        }
      } else if (qty < 1) {
        tone = 'bad';
        text = 'A whole number of at least one, please.';
      } else {
        tone = 'good';
        ok = true;
        text =
          '<strong>' +
          ui.escapeHtml(name) +
          '</strong>: ' +
          ui.number(now) +
          ' → <strong>' +
          ui.number(now + qty) +
          '</strong> held (+' +
          ui.number(qty) +
          ')';
      }
    }
    $('#add-preview')
      .attr('class', 'stock-preview stock-preview--' + tone)
      .html(text);
    $('#add-save').prop('disabled', !ok);
  }

  /**
   * In Remove mode, show the item's current quantity in the number box — the "original value" —
   * so the operator edits it down rather than working out a difference in their head. Called
   * when the item changes and when Remove is first chosen; never in Add, where the box is an
   * amount to add and starts empty.
   */
  function prefillRemoveQty() {
    if (state.add.dir !== 'remove') {
      return;
    }
    const item = addItemByKey($('#add-item').val());
    $('#add-qty').val(item ? heldQtyFor(item) : '');
  }

  function resetAddForm() {
    $('#add-qty, #add-note').val('');
    $('#add-item').val('').trigger('change');
    $('#add-status').text('');
    renderAddPreview();
  }

  /**
   * Make the form ready for the Mait whose stock has just loaded: remember what it can be
   * credited with and what it already holds, draw the kinds, and start on straws.
   */
  function openAddForm(data) {
    state.add.maitId = data.mait_id;
    state.add.maitName = data.mait_name;
    state.add.catalogue = data.catalogue || { breeds: [], products: [] };
    state.add.heldStraws = data.by_breed || {};

    const held = {};
    (data.consumables || []).concat(data.assets || []).forEach(function (line) {
      if (line.code) {
        held[line.code] = line.qty;
      }
    });
    state.add.heldItems = held;
    state.add.heldByKind = buildHeldByKind(data);

    // Reopen on Add every time: it is the common case, and starting on Remove would put a
    // destructive default in front of somebody who came to credit stock.
    state.add.dir = 'add';
    state.add.kind = 'straw';
    renderAddDir();
    renderAddKinds();
    fillAddItems('');
    $('#add-qty, #add-note').val('');
    $('#add-status').text('');
    renderAddPreview();
    $('#holding-add').prop('hidden', false);
  }

  /**
   * What the Mait holds, in the same item shape the dropdown uses, split by kind.
   *
   * Straws come from `by_breed`, joined to the catalogue for a readable name and the cow/buffalo
   * group; consumables and equipment come from the held lines, joined to the catalogue by code
   * so the removal carries the product id the API keys on. A held item the catalogue no longer
   * lists (a retired product) is left out — there is no id to remove it by.
   */
  function buildHeldByKind(data) {
    const catalogue = state.add.catalogue;
    const breedBy = {};
    (catalogue.breeds || []).forEach(function (breed) {
      breedBy[breed.code] = breed;
    });
    const straw = Object.keys(data.by_breed || {})
      .filter(function (code) {
        return (data.by_breed[code] || 0) > 0;
      })
      .map(function (code) {
        const known = breedBy[code];
        return {
          key: 'straw:' + code,
          code: code,
          name: known ? known.name : code,
          group: known ? (known.animal_type === 'BUFF' ? 'Buffalo' : 'Cow') : '',
          qty: data.by_breed[code],
        };
      });

    const consumable = [];
    const asset = [];
    (catalogue.products || []).forEach(function (product) {
      const qty = state.add.heldItems[product.code] || 0;
      if (qty <= 0) {
        return;
      }
      const entry = {
        key: 'consumable:' + product.id,
        code: product.code,
        name: product.name,
        unit: product.unit,
        qty: qty,
      };
      (product.category === 'asset' ? asset : consumable).push(entry);
    });

    return { straw: straw, consumable: consumable, asset: asset };
  }

  /** Reflect the chosen direction on the toggle, the headings, and the save button. */
  function renderAddDir() {
    const removing = state.add.dir === 'remove';
    $('#add-dir .segmented__option').each(function () {
      const on = $(this).data('dir') === state.add.dir;
      $(this).toggleClass('is-on', on).attr('aria-checked', String(on));
    });
    $('#addstock-title').text(removing ? 'Remove stock' : 'Add stock');
    $('#addstock-note').html(
      removing
        ? 'Take stock off this Mait — a count entered too high, or stock recorded against the ' +
            'wrong person. Recorded as an office adjustment, oldest straws first.'
        : 'A manual credit straight to this Mait, recorded as an office adjustment. The ' +
            'everyday way stock reaches a Mait is a store handing an approved ' +
            '<a href="indents.html">indent</a> over.'
    );
    $('#add-qty-label').text(removing ? 'New quantity' : 'How many to add?');
    $('#add-save')
      .text(removing ? 'Remove from stock' : 'Add to stock')
      .toggleClass('btn--primary', !removing)
      .toggleClass('btn--danger-outline', removing);
  }

  /**
   * Switch direction, keeping the chosen kind where it still has something to offer.
   *
   * Removing is restricted to what the Mait holds, so a kind they carry none of has nothing to
   * remove — if the current kind empties, fall to the first kind that does, and failing that
   * leave it as it is so the empty-state hint can explain itself.
   */
  function setAddDir(dir) {
    if (state.add.dir === dir) {
      return;
    }
    state.add.dir = dir;
    if (!addItemsOf(state.add.kind).length) {
      const firstWithItems = Object.keys(KINDS).filter(function (kind) {
        return addItemsOf(kind).length;
      })[0];
      if (firstWithItems) {
        state.add.kind = firstWithItems;
      }
    }
    renderAddDir();
    renderAddKinds();
    fillAddItems('');
    $('#add-qty').val('');
    $('#add-status').text('');
    renderAddPreview();
  }

  function submitAdd(event) {
    event.preventDefault();
    const removing = state.add.dir === 'remove';
    const key = $('#add-item').val();
    const item = addItemByKey(key);
    const field = Number($('#add-qty').val());
    if (!state.add.maitId || !item || isNaN(field)) {
      return;
    }

    const now = heldQtyFor(item);
    // The field means the *new quantity* when removing and the *amount to add* when adding, so
    // the move sent to the server is the difference in the first case and the number itself in
    // the second. Both guards mirror the preview, so a stale field cannot slip a bad move past.
    let qty;
    if (removing) {
      if (field < 0 || field >= now) {
        renderAddPreview();
        return;
      }
      qty = now - field;
    } else {
      if (field < 1) {
        return;
      }
      qty = field;
    }

    const parts = key.split(':');
    const body = {
      qty: qty,
      direction: state.add.dir,
      note: ($('#add-note').val() || '').trim(),
    };
    if (parts[0] === 'straw') {
      body.product_type = 'straw';
      body.breed = parts[1];
    } else {
      body.product_type = 'consumable';
      body.product_ref_id = Number(parts[1]);
    }
    const name = $('#add-item option:selected').text();

    $('#add-save, #add-reset').prop('disabled', true);
    $('#add-status').text(removing ? 'Removing…' : 'Adding…');
    MaitAI.shell.clearAlert();
    MaitAI.api
      .creditMaitStock(state.add.maitId, body)
      .done(function (fresh) {
        MaitAI.shell.alert(
          ui.number(qty) +
            ' ' +
            name +
            (removing ? ' removed from ' : ' added to ') +
            (fresh.mait_name || state.add.maitName) +
            '.',
          'good'
        );
        // The panel redraws straight from the response, so the cards and the held counts the
        // preview reads are the Mait's stock as it now stands — then the qty is cleared,
        // because the next change is a different one.
        showHolding(state.add.maitId);
        // And the list behind it, so the Mait's total and status move without a manual reload.
        load();
      })
      .fail(function (problem) {
        MaitAI.shell.alert(MaitAI.api.problemToLines(problem).join(' · '));
        $('#add-status').text(removing ? 'Not removed.' : 'Not added.');
      })
      .always(function () {
        $('#add-save, #add-reset').prop('disabled', false);
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
      // Add a delivery or correct the count — the same editor the Stores screen opens, reached
      // from here so a stock-out spotted on this oversight screen can be put right without
      // leaving to hunt the depot down on another one. Deep-links straight to its shelf.
      '<td class="table__action">' +
      '<a class="btn btn--good-outline" href="stores.html?stock=' +
      store.id +
      '">' +
      '<svg class="btn__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 5v14M5 12h14" /></svg>Add / reduce</a>' +
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
      7
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
      state.add.maitId = null;
    });

    // The add-stock form, inside the holding panel.
    $('#add-dir').on('click', '[data-dir]', function () {
      setAddDir($(this).data('dir'));
    });
    $('#add-kinds').on('click', '[data-kind]:not([disabled])', function () {
      setAddKind($(this).data('kind'));
    });
    // On a new item, Remove shows that item's current quantity to edit down; Add leaves the box
    // as an amount to type. Either way the preview then redraws.
    $('#add-item').on('change', function () {
      prefillRemoveQty();
      renderAddPreview();
    });
    $('#add-qty').on('input', renderAddPreview);
    $('#holding-add').on('click', '.stock-qty__step', function () {
      const now = Number($('#add-qty').val()) || 0;
      $('#add-qty').val(Math.max(0, now + Number($(this).data('step'))));
      renderAddPreview();
    });
    $('#holding-add-form').on('submit', submitAdd);
    $('#add-reset').on('click', resetAddForm);

    $('#search').on('input', render);

    $('#filter-low').on('click', function () {
      state.lowFirst = !state.lowFirst;
      $(this).toggleClass('is-active', state.lowFirst).attr('aria-pressed', String(state.lowFirst));
      render();
    });
  });
})(window.MaitAI, jQuery);
