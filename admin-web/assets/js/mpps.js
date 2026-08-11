/**
 * MPPs & assignment (W9).
 *
 * The assignment is what scopes a Mait's whole app (SRS §6.2.3), so this table is really a
 * map of where the platform can and cannot record anything.
 *
 * Three states, not two. Assigned and working; assigned to a Mait who has never been
 * activated, which records nothing while looking perfectly fine in SAP; and no Mait at all.
 * The middle one is the dangerous one — it is invisible unless the portal says so.
 */

(function (MaitAI, $) {
  'use strict';

  const ui = MaitAI.ui;
  const LIMIT = 25;

  const state = { offset: 0, unassignedOnly: false };

  function assignmentCell(mpp) {
    if (!mpp.mait) {
      // The Sahayak is not the Mait — they staff this collection point rather than covering
      // it — but they are the only contact the office has for an MPP nobody covers yet.
      return (
        '<span class="table__sub">No Mait assigned</span>' +
        (mpp.sahayak_name
          ? '<span class="table__sub">Sahayak: ' + ui.escapeHtml(mpp.sahayak_name) + '</span>'
          : '')
      );
    }
    return ui.identity(mpp.mait_name, mpp.mait_code);
  }

  function statusCell(mpp) {
    if (!mpp.mait) {
      return ui.pill('Assign', 'warn');
    }
    if (!mpp.mait_activated) {
      return ui.pill('Blocked', 'bad');
    }
    return ui.pill('Assigned', 'good');
  }

  function row(mpp) {
    const cls = !mpp.mait
      ? ' class="is-waiting"'
      : !mpp.mait_activated
        ? ' class="is-blocked"'
        : '';
    return (
      '<tr' +
      cls +
      '>' +
      '<td>' +
      ui.identity(mpp.mpp_name, ui.number(mpp.member_count) + ' members') +
      '</td>' +
      '<td><span class="table__code">' +
      ui.escapeHtml(mpp.mpp_code) +
      '</span></td>' +
      '<td>' +
      // Name over code, like every other identity cell in the portal. A plant number on its
      // own tells an admin as little as the district number it replaced.
      ui.identity(mpp.plant_name || '—', mpp.plant_code) +
      '</td>' +
      '<td>' +
      assignmentCell(mpp) +
      '</td>' +
      '<td>' +
      statusCell(mpp) +
      '</td>' +
      '</tr>'
    );
  }

  function query() {
    const params = { limit: LIMIT, offset: state.offset };
    const search = ($('#search').val() || '').trim();
    const plant = $('#filter-plant').val();

    if (search) {
      params.search = search;
    }
    if (plant) {
      params.plant_code = plant;
    }
    if (state.unassignedOnly) {
      // django-filter renders a null FK filter as an empty value on the FK field.
      params.mait = '';
    }
    return params;
  }

  function load() {
    MaitAI.shell.clearAlert();
    MaitAI.api
      .mpps(query())
      .done(function (page) {
        $('#mpp-count').text(ui.number(page.count) + ' MPPs');
        ui.rows($('#rows'), page.results, row, 'No MPPs match these filters.', 5);
        ui.pager(
          $('#pager'),
          { count: page.count, limit: LIMIT, offset: state.offset },
          function (offset) {
            state.offset = offset;
            load();
          }
        );
      })
      .fail(function (problem) {
        MaitAI.shell.alert(problem.detail);
        ui.rows($('#rows'), [], row, 'Could not load MPPs.', 5);
      });
  }

  function loadDistricts() {
    // Asked for, rather than derived from whichever page of the directory loaded first.
    // Districts used to be scraped out of the first 200 rows, which quietly omitted any that
    // happened to sort later; there are 19 plants and the endpoint returns all of them with
    // their names and how many MPPs report into each.
    MaitAI.api.plants().done(function (data) {
      $('#filter-plant').append(
        (data.results || [])
          .map(function (plant) {
            return (
              '<option value="' +
              ui.escapeHtml(plant.plant_code) +
              '">' +
              ui.escapeHtml(plant.plant_code + ' · ' + (plant.plant_name || '—')) +
              ' (' +
              ui.number(plant.mpp_count) +
              ')</option>'
            );
          })
          .join('')
      );
    });
  }

  $(function () {
    if (!MaitAI.shell.requireSession()) {
      return;
    }
    MaitAI.shell.mount();
    loadDistricts();
    load();

    let debounce = null;
    $('#search').on('input', function () {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(function () {
        state.offset = 0;
        load();
      }, 350);
    });

    $('#filter-plant').on('change', function () {
      state.offset = 0;
      load();
    });

    $('#filter-unassigned').on('click', function () {
      state.unassignedOnly = !state.unassignedOnly;
      state.offset = 0;
      $(this)
        .toggleClass('is-active', state.unassignedOnly)
        .attr('aria-pressed', String(state.unassignedOnly));
      load();
    });
  });
})(window.MaitAI, jQuery);
