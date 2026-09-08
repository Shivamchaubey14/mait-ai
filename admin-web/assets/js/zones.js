/**
 * Zone setup (W20).
 *
 * The dairy is run in zones — Bahraich, Pratapgarh — each covering several BMC/MCCs, and that
 * grouping exists nowhere in SAP. This is where it is decided.
 *
 * Two things make this screen what it is. The chilling centres are **not typed in**: they
 * arrive on every MPP row in the master data, so the list is a fixed set of nineteen and the
 * work is placing them, not naming them. And a centre belongs to **one** zone, so this screen
 * is a partition rather than a set of independent lists — which is why every box shows who
 * already holds it rather than simply refusing the save afterwards.
 *
 * What it decides is how much of the network an account sees. That is the same job Users &
 * roles does for screens, which is why the two sit together in the sidebar and why this one
 * borrows that screen's access grid rather than inventing a third way to tick a list.
 */

(function (MaitAI, $) {
  'use strict';

  const ui = MaitAI.ui;
  const api = MaitAI.api;

  const state = {
    zones: [],
    plants: [],
    editing: null,
    /** The codes ticked in the editor right now, which is not yet what is saved. */
    chosen: [],
  };

  /* --- the list ---------------------------------------------------------------------- */

  function plantSummary(zone) {
    const names = zone.plant_names || [];
    if (!names.length) {
      // Not a blank cell. An empty zone is a real and temporary state — it is being set up —
      // and it is also the state that shows its holders an empty dashboard, so it says so.
      return '<span class="table__sub">No BMC/MCC yet — anyone assigned sees nothing</span>';
    }
    return names
      .map(function (name) {
        return '<span class="chip chip--static">' + ui.escapeHtml(name) + '</span>';
      })
      .join(' ');
  }

  function row(zone) {
    return (
      '<tr' +
      (zone.is_active ? '' : ' class="is-blocked"') +
      '>' +
      '<td>' +
      ui.identity(zone.name, zone.code) +
      '</td>' +
      '<td class="zone-plants-cell">' +
      plantSummary(zone) +
      '</td>' +
      '<td class="table__num">' +
      ui.number(zone.mpp_count) +
      '</td>' +
      '<td class="table__num">' +
      ui.number(zone.member_count) +
      '</td>' +
      '<td class="table__num">' +
      // The number that makes deleting a zone consequential, shown before somebody tries.
      (zone.user_count ? ui.number(zone.user_count) : '<span class="table__sub">none</span>') +
      '</td>' +
      '<td>' +
      (zone.is_active ? ui.pill('Active', 'good') : ui.pill('Inactive', 'bad')) +
      '</td>' +
      '<td><button class="btn" type="button" data-edit="' +
      zone.id +
      '">Edit</button></td>' +
      '</tr>'
    );
  }

  function renderList() {
    const placed = state.plants.filter(function (plant) {
      return plant.zone_code;
    });
    const members = state.zones.reduce(function (total, zone) {
      return total + (zone.member_count || 0);
    }, 0);

    $('[data-kpi="zones"]').text(ui.number(state.zones.length));
    $('[data-kpi="zones-foot"]').text(
      state.zones.filter(function (zone) {
        return !zone.is_active;
      }).length + ' inactive'
    );

    $('[data-kpi="placed"]').text(placed.length + ' of ' + state.plants.length);
    const free = state.plants.length - placed.length;
    $('[data-kpi="placed-foot"]')
      .text(free ? free + ' still to place' : 'Every centre is in a zone')
      .removeClass('tile__foot--good tile__foot--bad')
      .addClass(free ? 'tile__foot--bad' : 'tile__foot--good');

    $('[data-kpi="members"]').text(ui.number(members));
    $('[data-kpi="members-foot"]').text('Across every zone');

    $('#zone-count').text(state.zones.length + (state.zones.length === 1 ? ' zone' : ' zones'));

    ui.rows(
      $('#rows'),
      state.zones,
      row,
      'No zones yet. Add the first one, then tick the BMC/MCCs it covers.',
      7
    );

    renderUnplaced();
  }

  /**
   * The centres nobody has placed.
   *
   * Listed by name rather than counted, and each one opens the editor with it already ticked.
   * A screen that says "3 unassigned" leaves an operator comparing two lists by eye to find
   * out which three.
   */
  function renderUnplaced() {
    const free = state.plants.filter(function (plant) {
      return !plant.zone_code;
    });
    $('[data-count="unplaced"]').text(ui.number(free.length));
    $('#unplaced-panel').prop('hidden', !free.length);

    if (!free.length) {
      return;
    }
    $('#unplaced').html(
      '<p class="exception__meta">Events recorded at these are counted in the network ' +
        'total but in no zone, so the zone rows on the dashboard will not add up to it.</p>' +
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

  /** Who holds this centre, if anybody — the zone being edited does not count as taken. */
  function heldBy(plant) {
    if (!plant.zone_code) {
      return null;
    }
    if (state.editing && plant.zone_code === state.editing.code) {
      return null;
    }
    return plant.zone_name;
  }

  function plantItem(plant) {
    const taken = heldBy(plant);
    const on = state.chosen.indexOf(plant.plant_code) >= 0;
    return (
      '<label class="access__item zone-plant' +
      (on ? ' is-on' : '') +
      (taken ? ' is-taken' : '') +
      '"' +
      // A centre another zone holds is disabled rather than hidden. Hiding it would leave an
      // operator hunting for NANPARA in a list that simply does not show it; disabled with
      // the holder's name answers the question on the spot.
      (taken ? ' title="Already in ' + ui.escapeHtml(taken) + '"' : '') +
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
        ? 'in ' + ui.escapeHtml(taken)
        : ui.number(plant.mpp_count) + ' MPPs · ' + ui.number(plant.member_count) + ' members') +
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

  /**
   * The count, and what saving would change.
   *
   * Removals are named rather than counted, the same way the access editor names them: taking
   * a centre out of a zone is the direction that makes somebody's dashboard smaller without
   * warning, and "removing NANPARA" is a sentence an operator can check before they save.
   */
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
      parts.push('Removing ' + removed.map(nameOf).join(', '));
    }
    $('#plant-diff').text(
      parts.length
        ? parts.join(' · ')
        : now.length
          ? 'No change to the centres in this zone.'
          : 'A zone with no centres shows anyone assigned to it an empty dashboard.'
    );
  }

  function openEditor(zone) {
    state.editing = zone || null;
    state.chosen = zone ? (zone.plants || []).slice() : [];
    const adding = !zone;

    $('#editor').prop('hidden', false).toggleClass('zone-editor--adding', adding);
    $('#editor-title').text(adding ? 'Add a zone' : zone.name);
    $('#editor-meta').text(
      adding
        ? 'Name it, then tick the centres it covers'
        : zone.code + ' · ' + (zone.user_count || 0) + ' account(s) read this zone'
    );
    $('#editor-state').html(
      adding ? '' : zone.is_active ? ui.pill('Active', 'good') : ui.pill('Inactive', 'bad')
    );

    $('#code')
      .val(adding ? '' : zone.code)
      .prop('readonly', !adding);
    $('#code-hint').text(
      adding ? 'Set once and never changed' : 'Fixed — accounts already point at this zone'
    );
    $('#name').val(adding ? '' : zone.name);
    $('#description').val(adding ? '' : zone.description || '');
    $('#remove').prop('hidden', adding);
    $('#editor-status').text(adding ? 'It can be assigned to an account as soon as you save.' : '');

    $('#plant-search').val('');
    renderPlantGrid();

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
    $('#save, #remove, #cancel').prop('disabled', on);
    $('#editor-status').text(on ? 'Saving…' : '');
  }

  function save() {
    const body = {
      name: ($('#name').val() || '').trim(),
      description: ($('#description').val() || '').trim(),
      plants: state.chosen,
    };
    if (!body.name) {
      MaitAI.shell.alert('Give the zone a name.', 'warn');
      $('#name').trigger('focus');
      return;
    }

    busy(true);
    const adding = !state.editing;
    if (adding) {
      body.code = ($('#code').val() || '').trim().toUpperCase();
      if (!body.code) {
        busy(false);
        MaitAI.shell.alert('Give the zone a code — ZONE1, or BAHRAICH.', 'warn');
        $('#code').trigger('focus');
        return;
      }
    }

    const request = adding ? api.createZone(body) : api.updateZone(state.editing.id, body);
    request
      .done(function (zone) {
        closeEditor();
        MaitAI.shell.alert(
          adding
            ? zone.name + ' created with ' + (zone.plants || []).length + ' BMC/MCC.'
            : zone.name + ' saved.',
          'good'
        );
        load();
      })
      .fail(failed)
      .always(function () {
        busy(false);
      });
  }

  function remove() {
    const zone = state.editing;
    if (!zone) {
      return;
    }
    // Named in the question. "Delete this zone?" is a dialog people click through; the name
    // and what it costs is one they read.
    const holders = zone.user_count || 0;
    const warning = holders
      ? '\n\n' +
        holders +
        ' account(s) read this zone. The server will refuse — move them first, or make the ' +
        'zone inactive instead.'
      : '';
    if (!window.confirm('Delete ' + zone.name + '?' + warning)) {
      return;
    }
    busy(true);
    api
      .deleteZone(zone.id)
      .done(function () {
        closeEditor();
        MaitAI.shell.alert(zone.name + ' deleted.', 'warn');
        load();
      })
      .fail(failed)
      .always(function () {
        busy(false);
      });
  }

  /* --- loading ----------------------------------------------------------------------- */

  function load() {
    MaitAI.shell.clearAlert();
    // Both, because neither screen state is readable without the other: a zone's row lists
    // centre names, and the editor's grid needs every centre's current holder.
    $.when(api.zones(), api.zonePlants())
      .done(function (zones, plants) {
        state.zones = zones[0].results || zones[0] || [];
        state.plants = plants[0].results || [];
        renderList();
        if (state.editing) {
          // The editor stays open across a reload only when something else changed under it;
          // its own saves close it first.
          const fresh = state.zones.filter(function (zone) {
            return zone.id === state.editing.id;
          })[0];
          if (fresh) {
            openEditor(fresh);
          }
        }
      })
      .fail(function (problem) {
        MaitAI.shell.alert(problem.detail || 'Could not load the zones.');
        ui.rows($('#rows'), [], row, 'Could not load the zones.', 7);
      });
  }

  $(function () {
    if (!MaitAI.shell.requireSession()) {
      return;
    }
    MaitAI.shell.mount();

    load();

    $('#add').on('click', function () {
      openEditor(null);
    });

    $('#rows').on('click', '[data-edit]', function () {
      const id = Number($(this).data('edit'));
      const zone = state.zones.filter(function (row_) {
        return row_.id === id;
      })[0];
      if (zone) {
        openEditor(zone);
      }
    });

    // An unplaced centre opens the editor for whichever zone it should join — but there is no
    // way to know which, so it opens a *new* zone with that centre already ticked. The common
    // case on a fresh install is building the zones one at a time from exactly this list.
    $('#unplaced').on('click', '[data-place]', function () {
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
      // The row's own class, not a re-render: redrawing the grid under a click loses the
      // pointer's place and, on a keyboard, the focus with it.
      $(this).closest('.access__item').toggleClass('is-on', on);
      renderDiff();
    });

    $('#plant-search').on('input', renderPlantGrid);

    $('#pick-free').on('click', function () {
      // Everything not already spoken for, plus whatever this zone already had. "Select all"
      // would be a lie on this screen — most centres cannot be ticked.
      visiblePlants().forEach(function (plant) {
        if (!heldBy(plant) && state.chosen.indexOf(plant.plant_code) < 0) {
          state.chosen.push(plant.plant_code);
        }
      });
      renderPlantGrid();
    });

    $('#pick-none').on('click', function () {
      state.chosen = [];
      renderPlantGrid();
    });

    $('#save').on('click', save);
    $('#remove').on('click', remove);
    $('#cancel').on('click', closeEditor);
  });
})(window.MaitAI, jQuery);
