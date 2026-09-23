/**
 * Store setup (W21).
 *
 * Each location has a store, and each store serves the BMC/MCCs around it. The zonal manager
 * approves an indent on the Indents screen; the keeper at the Mait's store hands it over from
 * the app. This is where the dairy says which store is which, and who stands behind each
 * counter.
 *
 * Built on the Zones screen, deliberately. Both draw a line around some chilling centres, and
 * both are a partition — a BMC/MCC collects from one store as it sits in one zone — so the
 * picker shows who already holds each centre rather than refusing the save afterwards. What
 * a zone does not have is people: the keepers, added here by name and the number they sign in
 * to the app with.
 *
 * And the shelf. **Stock** on a row opens that store's shelf beside a four-step change: add a
 * delivery or correct the count, then the kind (straws, consumables, equipment), the item and
 * the number — with a sentence saying what saving will do before it is done. A delivery adds;
 * a count replaces, and the server writes the difference to the store's ledger and refuses a
 * count below what is already packed for a Mait.
 */

(function (MaitAI, $) {
  'use strict';

  const ui = MaitAI.ui;
  const api = MaitAI.api;

  const state = {
    /** What is typed in the search box. The tiles above always count every store. */
    term: '',
    stores: [],
    plants: [],
    zones: [],
    editing: null,
    /** The codes ticked in the editor right now, which is not yet what is saved. */
    chosen: [],
    /** The store whose shelf is open, its lines, and what it can be stocked with. */
    stock: { store: null, lines: [], catalogue: { breeds: [], products: [] } },
    /** The change being written: add or count, and which kind of stock. */
    mode: 'receive',
    kind: 'straw',
  };

  /* --- the three kinds of stock ---------------------------------------------------------- */

  /** Each kind in its own colour and glyph, the way the zonal app draws them. */
  const KINDS = {
    straw: {
      label: 'Straws',
      tone: 'info',
      // A syringe, not a drop: a drop reads as milk on a dairy's screens.
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

  function glyph(kind) {
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round">' +
      KINDS[kind].icon +
      '</svg>'
    );
  }

  /* --- the list ---------------------------------------------------------------------- */

  /**
   * Whether a store answers to what was typed.
   *
   * Everything an operator might be holding when a keeper rings: the store's name or code,
   * its zone, the centres it serves, and each keeper's name and mobile. The mobile is matched
   * on digits alone, so "98765 00001" and "9876500001" find the same keeper. Keepers taken off
   * the store still match — "who used to work Barsana" is a question too.
   */
  function matchesStore(store, term) {
    if (!term) {
      return true;
    }
    const needle = term.toLowerCase();
    const digits = term.replace(/\D/g, '');
    const words = [store.name, store.code, store.zone_name || '', store.description || '']
      .concat(store.plant_names || [])
      .concat(
        (store.keepers || []).map(function (keeper) {
          return keeper.full_name;
        })
      );
    const byWord = words.some(function (word) {
      return String(word).toLowerCase().indexOf(needle) >= 0;
    });
    const byMobile =
      digits.length >= 3 &&
      (store.keepers || []).some(function (keeper) {
        return String(keeper.mobile_no || '').indexOf(digits) >= 0;
      });
    return byWord || byMobile;
  }

  function visibleStores() {
    return state.stores.filter(function (store) {
      return matchesStore(store, state.term);
    });
  }

  function plantSummary(store) {
    const names = store.plant_names || [];
    if (!names.length) {
      // A store serving nothing collects nobody's indents — a real state while it is being set
      // up, and one the row should admit to rather than leave blank.
      return '<span class="table__sub">No BMC/MCC yet — no Mait collects here</span>';
    }
    return names
      .map(function (name) {
        return '<span class="chip chip--static">' + ui.escapeHtml(name) + '</span>';
      })
      .join(' ');
  }

  function keeperSummary(store) {
    const on = (store.keepers || []).filter(function (keeper) {
      return keeper.is_active;
    });
    if (!on.length) {
      // Amber, because it is the one gap that stops the store working at all: indents will
      // queue here and nobody can hand them over.
      return '<span class="table__sub table__sub--warn">No keeper — nobody can issue</span>';
    }
    return on
      .map(function (keeper) {
        return ui.identity(keeper.full_name, keeper.mobile_no);
      })
      .join('');
  }

  /**
   * The shelf: one chip per item, the name and its count together.
   *
   * It was a run-on line — "37 Murrah · 40 Gir" — which is read word by word to answer "how
   * much Gir". A row per item answered that, but four items made the row three times as tall
   * as the two beside it and the table lost its rhythm. Chips wrap instead of stacking, so
   * the cell stays one or two lines deep and the count still has an edge to be found by.
   * Amber when there is none of it: a nil count is the only line worth stopping on.
   */
  function shelfSummary(store) {
    const lines = store.stock || [];
    if (!lines.length) {
      return '<span class="table__sub">Nothing recorded yet</span>';
    }
    return (
      '<div class="shelf">' +
      lines
        .map(function (line) {
          const qty = Number(line.on_hand) || 0;
          return (
            '<span class="shelf__chip shelf__chip--' +
            ui.escapeHtml(line.category || 'straw') +
            (qty ? '' : ' shelf__chip--nil') +
            '">' +
            '<span class="shelf__item">' +
            ui.escapeHtml(line.item_name) +
            '</span>' +
            '<span class="shelf__qty">' +
            ui.number(line.on_hand) +
            '</span>' +
            '</span>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function row(store) {
    return (
      '<tr' +
      (store.is_active ? '' : ' class="is-blocked"') +
      '>' +
      '<td>' +
      ui.identity(store.name, store.code + (store.zone_name ? ' · ' + store.zone_name : '')) +
      '</td>' +
      '<td class="zone-plants-cell">' +
      plantSummary(store) +
      '</td>' +
      '<td>' +
      keeperSummary(store) +
      '</td>' +
      '<td>' +
      shelfSummary(store) +
      '</td>' +
      '<td class="table__num">' +
      (store.open_indents
        ? '<a href="indents.html?status=approved">' + ui.number(store.open_indents) + '</a>'
        : '<span class="table__sub">none</span>') +
      '</td>' +
      '<td>' +
      (store.is_active ? ui.pill('Open', 'good') : ui.pill('Closed', 'bad')) +
      '</td>' +
      '<td class="table__action"><div class="table__actions">' +
      '<button class="btn btn--good-outline" type="button" data-stock="' +
      store.id +
      '">' +
      '<svg class="btn__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8" /></svg>Stock</button>' +
      '<button class="btn btn--warn" type="button" data-edit="' +
      store.id +
      '">' +
      '<svg class="btn__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>' +
      'Edit</button></div></td>' +
      '</tr>'
    );
  }

  function renderList() {
    const served = state.plants.filter(function (plant) {
      return plant.store_id;
    });
    const open = state.stores.reduce(function (total, store) {
      return total + (store.open_indents || 0);
    }, 0);
    const keeperless = state.stores.filter(function (store) {
      return (
        store.is_active &&
        !(store.keepers || []).some(function (keeper) {
          return keeper.is_active;
        })
      );
    }).length;

    $('[data-kpi="stores"]').text(ui.number(state.stores.length));
    $('[data-kpi="stores-foot"]')
      .text(keeperless ? keeperless + ' with no keeper' : 'Every open store has a keeper')
      .removeClass('tile__foot--good tile__foot--bad')
      .addClass(keeperless ? 'tile__foot--bad' : 'tile__foot--good');

    $('[data-kpi="served"]').text(served.length + ' of ' + state.plants.length);
    const free = state.plants.length - served.length;
    $('[data-kpi="served-foot"]')
      .text(free ? free + ' still issued from the portal' : 'Every centre has a store')
      .removeClass('tile__foot--good tile__foot--bad')
      .addClass(free ? 'tile__foot--bad' : 'tile__foot--good');

    $('[data-kpi="open"]').text(ui.number(open));
    $('[data-kpi="open-foot"]').text('Approved, not yet handed over');

    const shown = visibleStores();
    const noun = state.stores.length === 1 ? ' store' : ' stores';
    $('#store-count').text(
      state.term ? shown.length + ' of ' + state.stores.length + noun : state.stores.length + noun
    );

    ui.rows(
      $('#rows'),
      shown,
      row,
      state.term
        ? 'No store, keeper or BMC/MCC matches “' + state.term + '”.'
        : 'No stores yet. Add the first one, then tick the BMC/MCCs it serves.',
      7
    );

    renderUnserved();
  }

  function renderUnserved() {
    const free = state.plants.filter(function (plant) {
      return !plant.store_id;
    });
    $('[data-count="unserved"]').text(ui.number(free.length));
    $('#unserved-panel').prop('hidden', !free.length);
    if (!free.length) {
      return;
    }
    $('#unserved').html(
      '<p class="exception__meta">Maits here have no counter to collect from, so their ' +
        'indents are still issued from the Indents screen — with no code read out to prove ' +
        'the Mait was there.</p>' +
        '<div class="zone-free">' +
        free
          .map(function (plant) {
            return (
              '<button class="chip" type="button" data-place="' +
              ui.escapeHtml(plant.plant_code) +
              '">' +
              ui.escapeHtml(plant.plant_name) +
              '<span class="chip__meta">' +
              ui.number(plant.mpp_count) +
              ' MPPs</span></button>'
            );
          })
          .join('') +
        '</div>'
    );
  }

  /* --- the editor -------------------------------------------------------------------- */

  /** The store already serving this centre, if it is not the one being edited. */
  function heldBy(plant) {
    if (!plant.store_id) {
      return null;
    }
    if (state.editing && plant.store_id === state.editing.id) {
      return null;
    }
    return plant.store_name;
  }

  function plantItem(plant) {
    const taken = heldBy(plant);
    const on = state.chosen.indexOf(plant.plant_code) >= 0;
    return (
      '<label class="access__item zone-plant' +
      (on ? ' is-on' : '') +
      (taken ? ' is-taken' : '') +
      '"' +
      (taken ? ' title="Served by ' + ui.escapeHtml(taken) + '"' : '') +
      '>' +
      '<input class="access__check" type="checkbox" value="' +
      ui.escapeHtml(plant.plant_code) +
      '"' +
      (on ? ' checked' : '') +
      (taken ? ' disabled' : '') +
      ' />' +
      '<span class="access__name">' +
      ui.escapeHtml(plant.plant_name) +
      '<span class="access__meta">' +
      (taken
        ? 'served by ' + ui.escapeHtml(taken)
        : ui.number(plant.mpp_count) +
          ' MPPs' +
          (plant.zone_name ? ' · ' + ui.escapeHtml(plant.zone_name) : '')) +
      '</span>' +
      '</span>' +
      '<span class="access__state" aria-hidden="true"></span>' +
      '</label>'
    );
  }

  function visiblePlants() {
    const term = ($('#plant-search').val() || '').trim().toLowerCase();
    if (!term) {
      return state.plants;
    }
    return state.plants.filter(function (plant) {
      return (
        plant.plant_name.toLowerCase().indexOf(term) >= 0 ||
        plant.plant_code.toLowerCase().indexOf(term) >= 0
      );
    });
  }

  function renderPlantGrid() {
    const shown = visiblePlants();
    $('#plant-grid').html(
      shown.length
        ? shown.map(plantItem).join('')
        : '<p class="empty-state">No BMC/MCC matches that.</p>'
    );
    renderDiff();
  }

  /** Removals by name: taking a centre off a store sends its Maits somewhere else to collect. */
  function renderDiff() {
    const before = (state.editing && state.editing.plants) || [];
    const now = state.chosen;
    const nameOf = function (code) {
      const found = state.plants.filter(function (plant) {
        return plant.plant_code === code;
      })[0];
      return found ? found.plant_name : code;
    };

    $('#plant-count').text(
      now.length ? now.length + ' of ' + state.plants.length + ' ticked' : 'none ticked'
    );

    const added = now.filter(function (code) {
      return before.indexOf(code) < 0;
    });
    const removed = before.filter(function (code) {
      return now.indexOf(code) < 0;
    });
    const parts = [];
    if (added.length) {
      parts.push('Adding ' + added.map(nameOf).join(', '));
    }
    if (removed.length) {
      parts.push(
        'Removing ' + removed.map(nameOf).join(', ') + ' — their Maits stop collecting here'
      );
    }
    $('#plant-diff').text(
      parts.length
        ? parts.join(' · ')
        : now.length
          ? 'No change to the centres this store serves.'
          : 'A store serving no centre has no Maits collecting from it.'
    );
  }

  function renderKeepers() {
    const store = state.editing;
    const adding = !store;
    $('#keeper-add').prop('hidden', adding);
    if (adding) {
      $('#keepers').empty();
      $('#keeper-count').text('after saving');
      $('#keeper-hint').text('Save the store first, then give it a keeper.');
      return;
    }
    const keepers = store.keepers || [];
    const active = keepers.filter(function (keeper) {
      return keeper.is_active;
    }).length;
    $('#keeper-count').text(active ? active + ' can sign in' : 'none yet');
    $('#keeper-hint').text(
      "They sign in to the Mait AI app with this number and an OTP, and see this store's " +
        'queue and nothing else.'
    );
    $('#keepers').html(
      keepers
        .map(function (keeper) {
          return (
            '<li class="keeper' +
            (keeper.is_active ? '' : ' is-off') +
            '">' +
            '<div class="keeper__who"><p class="keeper__name">' +
            ui.escapeHtml(keeper.full_name) +
            '</p><p class="keeper__meta">' +
            ui.escapeHtml(keeper.mobile_no) +
            ' · ' +
            (keeper.is_active
              ? keeper.last_login_at
                ? 'last signed in ' + ui.date(keeper.last_login_at)
                : 'has not signed in yet'
              : 'taken off this store') +
            '</p></div>' +
            (keeper.is_active
              ? '<button class="btn btn--danger-outline" type="button" data-remove-keeper="' +
                keeper.id +
                '">Take off</button>'
              : '') +
            '</li>'
          );
        })
        .join('')
    );
  }

  function fillZones() {
    const $zone = $('#zone');
    $zone.find('option:not(:first)').remove();
    state.zones.forEach(function (zone) {
      $zone.append($('<option></option>').val(String(zone.id)).text(zone.name));
    });
  }

  function openEditor(store) {
    state.editing = store || null;
    state.chosen = store ? (store.plants || []).slice() : [];
    const adding = !store;

    $('#editor').prop('hidden', false).toggleClass('zone-editor--adding', adding);
    $('#editor-title').text(adding ? 'Add a store' : store.name);
    $('#editor-meta').text(
      adding
        ? 'Name it, then tick the centres it serves'
        : store.code + ' · ' + ui.number(store.mpp_count || 0) + ' MPPs collect here'
    );
    $('#editor-state').html(
      adding ? '' : store.is_active ? ui.pill('Open', 'good') : ui.pill('Closed', 'bad')
    );

    $('#code')
      .val(adding ? '' : store.code)
      .prop('readonly', !adding);
    $('#code-hint').text(adding ? 'Set once and never changed' : 'Fixed — slips carry it');
    $('#name').val(adding ? '' : store.name);
    $('#zone')
      .val(adding || !store.zone ? '' : String(store.zone))
      .trigger('change');
    $('#active')
      .val(adding || store.is_active ? 'true' : 'false')
      .trigger('change');
    $('#remove').prop('hidden', adding);
    $('#editor-status').text(adding ? 'Keepers can be added as soon as you save.' : '');
    $('#keeper-name, #keeper-mobile').val('');

    $('#plant-search').val('');
    renderPlantGrid();
    renderKeepers();

    $('#editor')[0].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    (adding ? $('#code') : $('#name')).trigger('focus');
  }

  function closeEditor() {
    state.editing = null;
    state.chosen = [];
    $('#editor').prop('hidden', true);
  }

  /* --- saving ------------------------------------------------------------------------ */

  function failed(problem) {
    MaitAI.shell.alert(MaitAI.api.problemToLines(problem).join(' · '));
    $('#editor-status').text('Not saved.');
  }

  function busy(on) {
    $('#save, #remove, #cancel, #keeper-save').prop('disabled', on);
    $('#editor-status').text(on ? 'Saving…' : '');
  }

  function save() {
    const body = {
      name: ($('#name').val() || '').trim(),
      zone: $('#zone').val() ? Number($('#zone').val()) : null,
      is_active: $('#active').val() === 'true',
      plants: state.chosen,
    };
    if (!body.name) {
      MaitAI.shell.alert('Give the store a name — Barsana depot.', 'warn');
      $('#name').trigger('focus');
      return;
    }

    const adding = !state.editing;
    if (adding) {
      body.code = ($('#code').val() || '').trim().toUpperCase();
      if (!body.code) {
        MaitAI.shell.alert('Give the store a code — BARSANA.', 'warn');
        $('#code').trigger('focus');
        return;
      }
    }

    busy(true);
    const request = adding ? api.createStore(body) : api.updateStore(state.editing.id, body);
    request
      .done(function (store) {
        MaitAI.shell.alert(
          adding ? store.name + ' created. Now give it a keeper.' : store.name + ' saved.',
          'good'
        );
        // A new store stays open, because the next thing to do is give it a keeper — which
        // needs the store to exist.
        load(adding ? store.id : null);
        if (!adding) {
          closeEditor();
        }
      })
      .fail(failed)
      .always(function () {
        busy(false);
      });
  }

  function remove() {
    const store = state.editing;
    if (!store) {
      return;
    }
    if (
      !window.confirm(
        'Delete ' +
          store.name +
          '?\n\nOnly a store nothing has happened at can be deleted — otherwise close it.'
      )
    ) {
      return;
    }
    busy(true);
    api
      .deleteStore(store.id)
      .done(function () {
        closeEditor();
        MaitAI.shell.alert(store.name + ' deleted.', 'warn');
        load();
      })
      .fail(failed)
      .always(function () {
        busy(false);
      });
  }

  function addKeeper() {
    const store = state.editing;
    const body = {
      full_name: ($('#keeper-name').val() || '').trim(),
      mobile_no: ($('#keeper-mobile').val() || '').replace(/\D/g, ''),
    };
    if (!body.full_name) {
      $('#keeper-hint').text('Give their name.');
      $('#keeper-name').trigger('focus');
      return;
    }
    if (body.mobile_no.length !== 10) {
      $('#keeper-hint').text('Their 10-digit mobile — the number the OTP goes to.');
      $('#keeper-mobile').trigger('focus');
      return;
    }
    busy(true);
    api
      .addStoreKeeper(store.id, body)
      .done(function (fresh) {
        MaitAI.shell.alert(
          body.full_name + ' can now sign in to the app with ' + body.mobile_no + '.',
          'good'
        );
        state.editing = fresh;
        $('#keeper-name, #keeper-mobile').val('');
        renderKeepers();
        load(fresh.id);
      })
      .fail(failed)
      .always(function () {
        busy(false);
      });
  }

  function removeKeeper(userId) {
    const store = state.editing;
    const keeper = (store.keepers || []).filter(function (row_) {
      return row_.id === userId;
    })[0];
    if (
      !keeper ||
      !window.confirm(
        'Take ' + keeper.full_name + ' off ' + store.name + '?\n\nTheir account stops signing in.'
      )
    ) {
      return;
    }
    busy(true);
    api
      .removeStoreKeeper(store.id, userId)
      .done(function (fresh) {
        state.editing = fresh;
        renderKeepers();
        load(fresh.id);
      })
      .fail(failed)
      .always(function () {
        busy(false);
      });
  }

  /* --- the shelf ------------------------------------------------------------------------ */

  function kindOf(line) {
    return line.category || (line.product_type === 'straw' ? 'straw' : 'consumable');
  }

  function keyOf(line) {
    return line.product_type === 'straw'
      ? 'straw:' + line.breed
      : 'consumable:' + String(line.product_ref_id);
  }

  /**
   * One item on the shelf: its name, how many, and — when some are packed for a Mait — the
   * split, as a bar and two words. "Correct" opens the form on it, already chosen.
   */
  function shelfLine(line) {
    const onHand = Number(line.on_hand) || 0;
    const packed = Number(line.set_aside) || 0;
    const free = Number(line.available) || 0;
    return (
      '<li class="shelf-line' +
      (onHand ? '' : ' shelf-line--nil') +
      '">' +
      '<div class="shelf-line__who">' +
      '<p class="shelf-line__name">' +
      ui.escapeHtml(line.item_name) +
      '</p>' +
      '<p class="shelf-line__meta">' +
      '<span class="shelf-line__free">' +
      ui.number(free) +
      ' free</span>' +
      (packed
        ? ' · <span class="shelf-line__packed">' + ui.number(packed) + ' packed</span>'
        : '') +
      (line.unit ? ' · ' + ui.escapeHtml(line.unit) : '') +
      '</p>' +
      (onHand
        ? '<span class="shelf-line__bar"><span class="shelf-line__fill" style="width:' +
          Math.round((free / onHand) * 100) +
          '%"></span></span>'
        : '') +
      '</div>' +
      '<span class="shelf-line__qty">' +
      ui.number(onHand) +
      '</span>' +
      '<button class="btn btn--warn-outline shelf-line__fix" type="button" data-correct="' +
      ui.escapeHtml(keyOf(line)) +
      '" data-kind="' +
      kindOf(line) +
      '">Correct</button>' +
      '</li>'
    );
  }

  function renderShelf() {
    const lines = state.stock.lines;
    const groups = Object.keys(KINDS).map(function (kind) {
      const mine = lines.filter(function (line) {
        return kindOf(line) === kind;
      });
      const total = mine.reduce(function (sum, line) {
        return sum + (Number(line.on_hand) || 0);
      }, 0);
      return (
        '<section class="shelf-group shelf-group--' +
        KINDS[kind].tone +
        '">' +
        '<header class="shelf-group__head">' +
        '<span class="shelf-group__icon" aria-hidden="true">' +
        glyph(kind) +
        '</span>' +
        '<h4 class="shelf-group__title">' +
        KINDS[kind].label +
        '</h4>' +
        '<span class="shelf-group__count">' +
        (mine.length
          ? mine.length + (mine.length === 1 ? ' item · ' : ' items · ') + ui.number(total)
          : 'none on the shelf') +
        '</span>' +
        '</header>' +
        (mine.length
          ? '<ul class="shelf-group__lines">' + mine.map(shelfLine).join('') + '</ul>'
          : '') +
        '</section>'
      );
    });
    $('#stock-shelf').html(groups.join(''));
  }

  /* --- the change --------------------------------------------------------------------- */

  /** What the chosen kind can be stocked with, from the catalogue. */
  function itemsOf(kind) {
    const catalogue = state.stock.catalogue;
    if (kind === 'straw') {
      return catalogue.breeds.map(function (breed) {
        return {
          key: 'straw:' + breed.code,
          name: breed.name,
          group: breed.animal_type === 'BUFF' ? 'Buffalo' : 'Cow',
        };
      });
    }
    return catalogue.products
      .filter(function (product) {
        return product.category === kind;
      })
      .map(function (product) {
        return { key: 'consumable:' + product.id, name: product.name, unit: product.unit };
      });
  }

  function lineFor(key) {
    return (
      state.stock.lines.filter(function (line) {
        return keyOf(line) === key;
      })[0] || null
    );
  }

  function renderKinds() {
    $('#stock-kinds').html(
      Object.keys(KINDS)
        .map(function (kind) {
          const count = itemsOf(kind).length;
          return (
            '<button type="button" role="radio" aria-checked="' +
            (kind === state.kind) +
            '" class="stock-kind stock-kind--' +
            KINDS[kind].tone +
            (kind === state.kind ? ' is-on' : '') +
            '" data-kind="' +
            kind +
            '"' +
            (count ? '' : ' disabled') +
            '>' +
            '<span class="stock-kind__icon" aria-hidden="true">' +
            glyph(kind) +
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
   * The item list for the chosen kind.
   *
   * No `<optgroup>`: the portal draws its own dropdown over the native select (controls.js),
   * and that menu is a flat list, so a Cow / Buffalo heading would silently vanish from it.
   * The animal rides in the label instead. `change` is triggered after every fill so the drawn
   * dropdown shows the value set here rather than the one before it.
   */
  function fillItems(keep) {
    const items = itemsOf(state.kind);
    const $item = $('#stock-item').empty();
    $item.append($('<option></option>').val('').text('Pick the item'));
    items.forEach(function (item) {
      $item.append(
        $('<option></option>')
          .val(item.key)
          .text(
            item.name +
              (item.group ? ' · ' + item.group : '') +
              (item.unit ? ' (' + item.unit + ')' : '')
          )
      );
    });
    const known = items.some(function (item) {
      return item.key === keep;
    });
    $item.val(keep && known ? keep : '').trigger('change');
  }

  function setMode(mode) {
    state.mode = mode;
    $('input[name="stock-mode"][value="' + mode + '"]').prop('checked', true);
    $('.stock-mode').removeClass('is-on');
    $('.stock-mode--' + mode).addClass('is-on');
    $('#stock-qty-label').text(
      mode === 'receive' ? 'How many arrived?' : 'How many are on the shelf now?'
    );
    $('#stock-save').text(mode === 'receive' ? 'Add to stock' : 'Save the count');
    renderPreview();
  }

  function setKind(kind, keep) {
    state.kind = kind;
    renderKinds();
    fillItems(keep);
    renderPreview();
  }

  /**
   * What saving will do, in one sentence, coloured by what it is: green for a delivery, yolk for
   * a correction, red for the change the server would refuse. Said before the button is
   * pressed, because a count typed into the wrong line is only obvious once it is read back.
   */
  function renderPreview() {
    const key = $('#stock-item').val();
    const raw = ($('#stock-qty').val() || '').trim();
    const qty = raw === '' ? null : Number(raw);
    const $preview = $('#stock-preview');
    const line = key ? lineFor(key) : null;
    const now = line ? Number(line.on_hand) || 0 : 0;
    const packed = line ? Number(line.set_aside) || 0 : 0;
    const name = key ? $('#stock-item option:selected').text() : '';

    $('#stock-item-hint').text(
      key
        ? line
          ? ui.number(now) +
            ' on the shelf now' +
            (packed ? ', ' + ui.number(packed) + ' of them packed for Maits' : '')
          : 'None of this on the shelf yet'
        : 'Pick what arrived, or what was counted'
    );

    let tone = 'quiet';
    let text = 'Pick the item and the number, and this says what saving will do.';
    let ok = false;
    if (key && qty !== null && !isNaN(qty)) {
      if (qty < 0 || Math.floor(qty) !== qty) {
        tone = 'bad';
        text = 'A whole number, please.';
      } else if (state.mode === 'receive') {
        if (qty < 1) {
          tone = 'bad';
          text = 'A delivery is at least one.';
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
            '</strong> on the shelf (+' +
            ui.number(qty) +
            ')';
        }
      } else if (qty < packed) {
        tone = 'bad';
        text =
          ui.number(packed) +
          ' are packed for Maits who have not collected yet — the count cannot be below ' +
          ui.number(packed) +
          '.';
      } else if (qty === now) {
        tone = 'quiet';
        text = 'The shelf already holds ' + ui.number(now) + ' — nothing to change.';
      } else {
        tone = 'warn';
        ok = true;
        const change = qty - now;
        text =
          '<strong>' +
          ui.escapeHtml(name) +
          '</strong>: ' +
          ui.number(now) +
          ' → <strong>' +
          ui.number(qty) +
          '</strong> on the shelf (' +
          (change > 0 ? '+' : '−') +
          ui.number(Math.abs(change)) +
          ', recorded as a correction)';
      }
    }
    $preview.attr('class', 'stock-preview stock-preview--' + tone).html(text);
    $('#stock-save').prop('disabled', !ok);
  }

  function openStock(store) {
    closeEditor();
    state.stock.store = store;
    $('#stock').prop('hidden', false);
    $('#stock-title').text(store.name);
    $('#stock-meta').text(
      store.code + (store.zone_name ? ' · ' + store.zone_name : '') + ' · stock'
    );
    $('#stock-shelf').html('<p class="empty-state">Loading the shelf…</p>');
    $('#stock-qty, #stock-note').val('');
    $('#stock-status').text('');
    $('#stock')[0].scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    api
      .storeStock(store.id)
      .done(function (body) {
        state.stock.lines = body.lines || [];
        state.stock.catalogue = body.catalogue || { breeds: [], products: [] };
        renderShelf();
        setMode('receive');
        setKind('straw');
      })
      .fail(function (problem) {
        $('#stock-shelf').html('<p class="empty-state">Could not load this shelf.</p>');
        MaitAI.shell.alert(problem.detail || 'Could not load the shelf.');
      });
  }

  function closeStock() {
    state.stock.store = null;
    $('#stock').prop('hidden', true);
  }

  function saveStock(event) {
    event.preventDefault();
    const store = state.stock.store;
    const key = $('#stock-item').val();
    if (!store || !key) {
      return;
    }
    const parts = key.split(':');
    const body = {
      mode: state.mode,
      product_type: parts[0],
      qty: Number($('#stock-qty').val()),
      note: ($('#stock-note').val() || '').trim(),
    };
    if (parts[0] === 'straw') {
      body.breed = parts[1];
    } else {
      body.product_ref_id = Number(parts[1]);
    }
    const name = $('#stock-item option:selected').text();

    $('#stock-save, #stock-reset').prop('disabled', true);
    $('#stock-status').text('Saving…');
    api
      .updateStoreStock(store.id, body)
      .done(function (fresh) {
        state.stock.lines = fresh.lines || [];
        renderShelf();
        $('#stock-qty, #stock-note').val('');
        $('#stock-status').text('');
        const after = lineFor(key);
        MaitAI.shell.alert(
          name +
            ' at ' +
            store.name +
            ' now ' +
            ui.number(after ? after.on_hand : 0) +
            ' on the shelf.',
          'good'
        );
        // The row's own shelf chips, without waiting for the whole list.
        state.stores = state.stores.map(function (row_) {
          return row_.id === store.id ? fresh.store : row_;
        });
        renderList();
        renderPreview();
      })
      .fail(function (problem) {
        MaitAI.shell.alert(MaitAI.api.problemToLines(problem).join(' · '));
        $('#stock-status').text('Not saved.');
      })
      .always(function () {
        $('#stock-reset').prop('disabled', false);
        renderPreview();
      });
  }

  /* --- loading ----------------------------------------------------------------------- */

  /** `reopen` is the store to leave the editor open on once the list is fresh. */
  function load(reopen) {
    MaitAI.shell.clearAlert();
    $.when(api.stores(), api.storePlants(), api.zones())
      .done(function (stores, plants, zones) {
        state.stores = stores[0].results || stores[0] || [];
        state.plants = plants[0].results || [];
        state.zones = (zones[0].results || zones[0] || []).filter(function (zone) {
          return zone.is_active;
        });
        fillZones();
        renderList();
        if (reopen) {
          const fresh = state.stores.filter(function (store) {
            return store.id === reopen;
          })[0];
          if (fresh) {
            openEditor(fresh);
          }
        }
      })
      .fail(function (problem) {
        MaitAI.shell.alert(problem.detail || 'Could not load the stores.');
        ui.rows($('#rows'), [], row, 'Could not load the stores.', 7);
      });
  }

  $(function () {
    if (!MaitAI.shell.requireSession()) {
      return;
    }
    MaitAI.shell.mount();

    load();

    // Filtered as it is typed: a handful of stores is not worth a round trip, and the list
    // already carries every name and number the search looks at.
    $('#search').on('input', function () {
      state.term = ($(this).val() || '').trim();
      renderList();
    });

    $('#add').on('click', function () {
      closeStock();
      openEditor(null);
    });

    $('#rows').on('click', '[data-stock]', function () {
      const id = Number($(this).data('stock'));
      const store = state.stores.filter(function (row_) {
        return row_.id === id;
      })[0];
      if (store) {
        openStock(store);
      }
    });

    $('#stock-close').on('click', closeStock);
    $('#stock-form').on('submit', saveStock);
    $('input[name="stock-mode"]').on('change', function () {
      setMode($(this).val());
    });
    $('#stock-kinds').on('click', '[data-kind]', function () {
      setKind($(this).data('kind'));
    });
    $('#stock-item').on('change', renderPreview);
    $('#stock-qty').on('input', renderPreview);
    $('.stock-qty__step').on('click', function () {
      const now = Number($('#stock-qty').val()) || 0;
      $('#stock-qty').val(Math.max(0, now + Number($(this).data('step'))));
      renderPreview();
    });
    $('#stock-reset').on('click', function () {
      $('#stock-qty, #stock-note').val('');
      $('#stock-item').val('').trigger('change');
    });
    // "Correct" on a shelf line: the count form, on that item, with its count to start from.
    $('#stock-shelf').on('click', '[data-correct]', function () {
      const key = String($(this).data('correct'));
      setMode('count');
      setKind(String($(this).data('kind')), key);
      const line = lineFor(key);
      $('#stock-qty')
        .val(line ? line.on_hand : 0)
        .trigger('focus');
      renderPreview();
    });

    $('#rows').on('click', '[data-edit]', function () {
      const id = Number($(this).data('edit'));
      const store = state.stores.filter(function (row_) {
        return row_.id === id;
      })[0];
      if (store) {
        closeStock();
        openEditor(store);
      }
    });

    // An unserved centre opens a new store with it already ticked: on a fresh install the
    // stores get built one at a time from exactly this list.
    $('#unserved').on('click', '[data-place]', function () {
      const code = String($(this).data('place'));
      openEditor(null);
      state.chosen = [code];
      renderPlantGrid();
      $('#code').trigger('focus');
    });

    $('#plant-grid').on('change', '.access__check', function () {
      const code = $(this).val();
      const on = $(this).is(':checked');
      const at = state.chosen.indexOf(code);
      if (on && at < 0) {
        state.chosen.push(code);
      } else if (!on && at >= 0) {
        state.chosen.splice(at, 1);
      }
      $(this).closest('.access__item').toggleClass('is-on', on);
      renderDiff();
    });

    $('#plant-search').on('input', renderPlantGrid);

    // The store's zone is the usual shape of its catchment, so this ticks every centre in that
    // zone that no other store already serves.
    $('#pick-zone').on('click', function () {
      const zoneId = $('#zone').val();
      const zone = state.zones.filter(function (row_) {
        return String(row_.id) === zoneId;
      })[0];
      if (!zone) {
        $('#plant-diff').text('Pick the zone first.');
        return;
      }
      (zone.plants || []).forEach(function (code) {
        const plant = state.plants.filter(function (row_) {
          return row_.plant_code === code;
        })[0];
        if (plant && !heldBy(plant) && state.chosen.indexOf(code) < 0) {
          state.chosen.push(code);
        }
      });
      renderPlantGrid();
    });

    $('#pick-none').on('click', function () {
      state.chosen = [];
      renderPlantGrid();
    });

    $('#keeper-save').on('click', addKeeper);
    $('#keepers').on('click', '[data-remove-keeper]', function () {
      removeKeeper(Number($(this).data('remove-keeper')));
    });

    $('#save').on('click', save);
    $('#remove').on('click', remove);
    $('#cancel').on('click', closeEditor);
  });
})(window.MaitAI, jQuery);
