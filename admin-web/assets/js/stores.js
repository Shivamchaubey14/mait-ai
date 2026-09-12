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
  };

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

  function shelfSummary(store) {
    const lines = store.stock || [];
    if (!lines.length) {
      return '<span class="table__sub">Nothing recorded yet</span>';
    }
    return (
      '<span class="store-shelf">' +
      lines
        .map(function (line) {
          return ui.number(line.on_hand) + ' ' + ui.escapeHtml(line.item_name);
        })
        .join(' · ') +
      '</span>'
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
      '<td><button class="btn" type="button" data-edit="' +
      store.id +
      '">Edit</button></td>' +
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
      openEditor(null);
    });

    $('#rows').on('click', '[data-edit]', function () {
      const id = Number($(this).data('edit'));
      const store = state.stores.filter(function (row_) {
        return row_.id === id;
      })[0];
      if (store) {
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
