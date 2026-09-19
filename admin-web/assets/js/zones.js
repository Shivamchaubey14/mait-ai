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
 *
 * **The second half of the screen is the people.** A zone is a line round some chilling
 * centres until somebody is standing inside it, and since the zonal manager's app landed
 * (2026-09-19) the mobile number on that person's account decides something operational: it
 * is where a sign-in code is sent, so a zone with no number on it is a manager who can only
 * work at a desk. So the managers are listed here with their number, editable in place, and
 * under them the record of what they have actually been doing in the zone — the same audit
 * rows the Audit log screen reads, narrowed to these people.
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

    /* --- the people ----------------------------------------------------------------- */
    managers: [],
    /** The manager whose number is open for editing, or null. */
    editingManager: null,
    /** Which manager the activity feed is narrowed to — null is all of them. */
    who: null,
    activityDays: 30,
    /**
     * `decisions` or `all`. Decisions by default, and that is not a detail: a manager who
     * works in the portal signs in and out several times a day, so the unfiltered trail is
     * ninety sign-ins with the two approvals somebody came to read buried inside them.
     */
    activityKind: 'decisions',
    activity: [],
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

    renderManagerTile();

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

  /* --- the people who run the zones ---------------------------------------------------
   * Drawn from `/admin/zones/managers/`, which is the zone-scoped accounts and nothing else:
   * a head-office Admin has no zone and is not the manager of one, so listing them here would
   * turn this panel into a second copy of Users & roles.
   */

  function renderManagerTile() {
    const managers = state.managers;
    const missing = managers.filter(function (manager) {
      return !manager.mobile_no;
    }).length;

    $('[data-kpi="managers"]').text(ui.number(managers.length));
    // The foot line carries the colour, as every stat tile on this portal does: red for a
    // figure somebody has to act on, green for one that is simply fine.
    $('[data-kpi="managers-foot"]')
      .text(
        !managers.length
          ? 'Nobody is scoped to a zone yet'
          : missing
            ? missing + (missing === 1 ? ' has no number — no app' : ' have no number — no app')
            : 'All of them can sign in to the app'
      )
      .removeClass('tile__foot--good tile__foot--bad')
      .addClass(
        managers.length && !missing ? 'tile__foot--good' : missing ? 'tile__foot--bad' : ''
      );
  }

  /** Initials, for the disc that makes a column of names scannable. */
  function initials(name) {
    const parts = String(name || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) {
      return '—';
    }
    return parts
      .slice(0, 2)
      .map(function (word) {
        return word.charAt(0).toUpperCase();
      })
      .join('');
  }

  /**
   * The number cell, which is also the control that changes it.
   *
   * The same bargain Users & roles makes with its Pages and Zones columns: clicking the thing
   * you want to change is a shorter sentence than finding a button for it, and this table has
   * no Action column to put one in. A manager with no number says so in amber rather than
   * leaving an empty cell — a blank here reads as a portal that failed to load a column.
   */
  function mobileCell(manager) {
    const said = manager.mobile_no
      ? '<span class="table__code">' + ui.escapeHtml(manager.mobile_no) + '</span>'
      : '<span class="table__sub table__sub--warn">No number</span>';
    return (
      '<button class="pages-link" type="button" data-mobile="' +
      manager.id +
      '" title="Set the number they sign into the app with">' +
      said +
      '</button>'
    );
  }

  /**
   * What this account did in the window, as the two figures a manager is measured by.
   *
   * Approvals and rejections rather than a bare action count: an account that signed in
   * forty times and decided nothing is a different problem from one that decided forty
   * things, and one number cannot tell them apart.
   */
  function decisionCell(manager) {
    const stats = manager.activity || {};
    if (!stats.actions) {
      return '<span class="table__sub">Nothing in ' + state.activityDays + ' days</span>';
    }
    const parts = [];
    if (stats.approved) {
      parts.push(ui.pill(stats.approved + ' approved', 'good'));
    }
    if (stats.rejected) {
      parts.push(ui.pill(stats.rejected + ' rejected', 'bad'));
    }
    if (!parts.length) {
      parts.push('<span class="table__sub">No indent decisions</span>');
    }
    return (
      parts.join(' ') +
      '<span class="table__sub">' +
      ui.number(stats.actions) +
      ' actions in all</span>'
    );
  }

  function appCell(manager) {
    if (!manager.is_active) {
      return ui.pill('Deactivated', 'bad');
    }
    if (manager.app_access) {
      return ui.pill('App', 'good');
    }
    // Two different reasons, and they need two different people to fix them: a number is
    // typed on this screen, a switched-off zone is switched back on above it.
    if (!manager.zone_names.length) {
      return (
        ui.pill('Zone off', 'warn') +
        '<span class="table__sub">' +
        ui.escapeHtml(manager.inactive_zones.join(', ')) +
        '</span>'
      );
    }
    return ui.pill('Portal only', 'warn');
  }

  function managerRow(manager) {
    return (
      '<tr' +
      (manager.is_active ? '' : ' class="is-blocked"') +
      '>' +
      '<td>' +
      ui.identity(manager.full_name, manager.username) +
      '</td>' +
      '<td>' +
      (manager.zone_names.length
        ? manager.zone_names
            .map(function (name) {
              return '<span class="chip chip--static">' + ui.escapeHtml(name) + '</span>';
            })
            .join(' ')
        : '<span class="table__sub">No live zone</span>') +
      // How big the patch is, under the zone rather than in a column of its own. "Ayodhya
      // Zone" decides nothing on its own; "Ayodhya Zone — 15 Maits" is the sentence somebody
      // reads when they are deciding who to ring.
      '<span class="table__sub">' +
      (manager.maits ? ui.number(manager.maits) + ' Maits' : 'no Maits yet') +
      '</span>' +
      '</td>' +
      '<td>' +
      mobileCell(manager) +
      '</td>' +
      '<td>' +
      appCell(manager) +
      '</td>' +
      '<td>' +
      (manager.last_login_at
        ? ui.dateTime(manager.last_login_at)
        : '<span class="table__sub">Never</span>') +
      '</td>' +
      '<td>' +
      decisionCell(manager) +
      '</td>' +
      '</tr>'
    );
  }

  function renderManagers() {
    $('[data-count="managers"]').text(
      state.managers.length + (state.managers.length === 1 ? ' account' : ' accounts')
    );
    ui.rows(
      $('#manager-rows'),
      state.managers,
      managerRow,
      'Nobody is scoped to a zone yet. Give an account its zone on Users & roles, ' +
        'and its number here.',
      6
    );
    renderManagerTile();
    renderWhoChips();
  }

  /* --- the number editor ---------------------------------------------------------------- */

  function renderAppHint() {
    const manager = state.editingManager;
    const numbered = String($('#mx-mobile').val() || '').trim().length > 0;
    const zoned = manager && manager.zone_names.length > 0;
    const $hint = $('#mx-app').removeClass('field__hint--ok field__hint--warn');

    if (numbered && zoned) {
      $hint.addClass('field__hint--ok').text('A sign-in code will be sent to this number.');
      return;
    }
    if (numbered) {
      $hint
        .addClass('field__hint--warn')
        .text('Their zone is switched off, so the app would open onto nothing.');
      return;
    }
    $hint
      .addClass('field__hint--warn')
      .text('With no number they can only work in the portal — nothing can send them a code.');
  }

  function openManagerEditor(manager) {
    state.editingManager = manager;
    closeEditor();

    $('#mx-initials').text(initials(manager.full_name));
    $('#mx-name').text(manager.full_name || manager.username);
    $('#mx-username').text(manager.username);
    $('#mx-state').html(appCell(manager));
    $('#mx-mobile').val(manager.mobile_no || '');
    $('#mx-zones').text(
      manager.zone_names.length
        ? manager.zone_names.join(', ')
        : manager.inactive_zones.length
          ? manager.inactive_zones.join(', ') + ' — switched off'
          : 'None'
    );
    $('#mx-status').text('—');
    renderAppHint();

    $('#manager-panel').prop('hidden', false);
    $('#manager-panel')[0].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function closeManagerEditor() {
    state.editingManager = null;
    $('#manager-panel').prop('hidden', true);
  }

  function saveManager() {
    const manager = state.editingManager;
    if (!manager) {
      return;
    }
    const mobile = String($('#mx-mobile').val() || '').trim();
    $('#mx-save').prop('disabled', true);
    $('#mx-status').text('Saving…');

    api
      .setZoneManagerMobile(manager.id, mobile)
      .done(function (updated) {
        closeManagerEditor();
        // The response is the row, so the table is rewritten from it rather than reloaded —
        // which would throw away the operator's place on a long screen to change one cell.
        state.managers = state.managers.map(function (row_) {
          return row_.id === updated.id ? updated : row_;
        });
        renderManagers();
        MaitAI.shell.alert(
          updated.mobile_no
            ? updated.full_name + ' can sign in to the app on ' + updated.mobile_no + '.'
            : updated.full_name + ' no longer has the app. Their portal login is unchanged.',
          'good'
        );
      })
      .fail(function (problem) {
        $('#mx-status').text('');
        MaitAI.shell.alert(api.problemToLines(problem).join(' · '));
      })
      .always(function () {
        $('#mx-save').prop('disabled', false);
      });
  }

  /* --- what they have done ---------------------------------------------------------------
   * The audit trail, narrowed to these accounts. A feed rather than a table: every row is one
   * sentence with a time against it, and four columns of mostly-empty cells would make that
   * harder to read rather than easier.
   */

  function relative(iso) {
    const then = new Date(iso).getTime();
    if (isNaN(then)) {
      return '';
    }
    const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (seconds < 90) {
      return 'just now';
    }
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
      return minutes + ' min ago';
    }
    const hours = Math.round(minutes / 60);
    if (hours < 24) {
      return hours + (hours === 1 ? ' hour ago' : ' hours ago');
    }
    const days = Math.round(hours / 24);
    return days === 1 ? 'yesterday' : days + ' days ago';
  }

  function renderWhoChips() {
    const chips = [
      '<button class="chip' +
        (state.who === null ? ' is-active' : '') +
        '" type="button" data-who="">Everyone<small>' +
        ui.number(
          state.managers.reduce(function (total, manager) {
            return total + ((manager.activity && manager.activity.actions) || 0);
          }, 0)
        ) +
        '</small></button>',
    ];
    state.managers.forEach(function (manager) {
      chips.push(
        '<button class="chip' +
          (state.who === manager.id ? ' is-active' : '') +
          '" type="button" data-who="' +
          manager.id +
          '">' +
          ui.escapeHtml(manager.full_name) +
          '<small>' +
          ui.number((manager.activity && manager.activity.actions) || 0) +
          '</small></button>'
      );
    });
    $('#activity-who').html(chips.join(''));
  }

  function activityRow(entry) {
    return (
      '<article class="zone-act">' +
      '<span class="zone-act__avatar" aria-hidden="true">' +
      ui.escapeHtml(entry.actor.initials) +
      '</span>' +
      '<div class="zone-act__body">' +
      '<p class="zone-act__line">' +
      ui.pill(entry.action_label, entry.tone) +
      ' <span class="zone-act__summary">' +
      ui.escapeHtml(entry.summary) +
      '</span></p>' +
      '<p class="zone-act__meta">' +
      ui.escapeHtml(entry.actor.name) +
      ' · ' +
      ui.escapeHtml(ui.dateTime(entry.when)) +
      ' · ' +
      ui.escapeHtml(relative(entry.when)) +
      '</p>' +
      '</div>' +
      '</article>'
    );
  }

  function renderActivity() {
    const $feed = $('#activity').removeAttr('aria-busy');
    $('[data-count="activity"]').text(
      state.activity.length
        ? state.activity.length + (state.activity.length === 1 ? ' action' : ' actions')
        : 'nothing yet'
    );
    if (!state.activity.length) {
      // Written out rather than left blank: an empty feed is a real answer here — a manager
      // who has decided nothing in thirty days is exactly what somebody opens this to find.
      $feed.html(
        '<p class="empty-state">Nothing in the last ' +
          state.activityDays +
          ' days. ' +
          (state.activityKind === 'decisions'
            ? 'Every approval, rejection and edit shows up here as it happens — sign-ins are ' +
              'under Everything.'
            : 'Every action shows up here as it happens.') +
          '</p>'
      );
      return;
    }
    $feed.html(state.activity.map(activityRow).join(''));
  }

  function loadPeople() {
    const query = { days: state.activityDays, kind: state.activityKind };
    if (state.who !== null) {
      query.manager = state.who;
    }

    $.when(api.zoneManagers(state.activityDays), api.zoneActivity(query))
      .done(function (managers, activity) {
        state.managers = managers[0].results || [];
        state.activity = activity[0].results || [];
        renderManagers();
        renderActivity();
      })
      .fail(function () {
        // Not an alert over the whole screen. Zones are what this page is for; the people are
        // the half below, and a red banner over a working table because one panel failed is
        // the loudest thing on screen for the least important reason.
        ui.rows($('#manager-rows'), [], managerRow, 'Could not load the managers.', 6);
        $('#activity')
          .removeAttr('aria-busy')
          .html('<p class="empty-state">Could not load what they have done.</p>');
      });
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
    // Its own request rather than part of the `$.when` below: the people are a second
    // question about the same screen, and a zone table that waited on the audit trail to
    // paint would be slower for the operator who only came to move a chilling centre.
    loadPeople();
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

    /* --- the people ------------------------------------------------------------------- */

    $('#manager-rows').on('click', '[data-mobile]', function () {
      const id = Number($(this).data('mobile'));
      const manager = state.managers.filter(function (row_) {
        return row_.id === id;
      })[0];
      if (manager) {
        openManagerEditor(manager);
      }
    });

    // Digits only, and the sentence under it keeps up as they are typed — the field decides
    // whether an app opens, so it should not wait for a save to say so.
    $('#mx-mobile').on('input', function () {
      this.value = this.value.replace(/\D/g, '').slice(0, 10);
      renderAppHint();
    });

    $('#mx-save').on('click', saveManager);
    $('#mx-cancel').on('click', closeManagerEditor);

    $('#activity-who').on('click', '.chip', function () {
      const raw = String($(this).data('who'));
      state.who = raw === '' ? null : Number(raw);
      renderWhoChips();
      loadPeople();
    });

    $('#activity-days').on('change', function () {
      state.activityDays = Number($(this).val()) || 30;
      loadPeople();
    });

    $('#activity-kind').on('click', '.chip', function () {
      state.activityKind = String($(this).data('kind'));
      $('#activity-kind .chip').removeClass('is-active');
      $(this).addClass('is-active');
      loadPeople();
    });
  });
})(window.MaitAI, jQuery);
