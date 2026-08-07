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
      ui.escapeHtml(mpp.district_code || '—') +
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
    const district = $('#filter-district').val();

    if (search) {
      params.search = search;
    }
    if (district) {
      params.district_code = district;
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
    // Derived from the first page rather than a lookup endpoint: districts are a SAP code
    // with no master of their own, and the list is short enough to be useful this way.
    MaitAI.api.mpps({ limit: 200 }).done(function (page) {
      const seen = {};
      (page.results || []).forEach(function (mpp) {
        if (mpp.district_code) {
          seen[mpp.district_code] = true;
        }
      });
      $('#filter-district').append(
        Object.keys(seen)
          .sort()
          .map(function (code) {
            return (
              '<option value="' + ui.escapeHtml(code) + '">' + ui.escapeHtml(code) + '</option>'
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

    $('#filter-district').on('change', function () {
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
