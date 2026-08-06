/**
 * Members list (W10).
 *
 * 105,000 rows from the SAP master, so this screen is search-first: nobody browses it.
 *
 * A member with no usable mobile number is the case that matters. 1.5% of the master is in
 * that state and those members cannot authorise a payment, which means a Mait who starts a
 * flow for one is stranded with the insemination already performed
 * (docs/DATA_FINDINGS.md §2). They are shown, flagged, and never quietly filtered out —
 * hiding them would leave an operator insisting a member exists while the portal denies it.
 */

(function (MaitAI, $) {
  'use strict';

  const ui = MaitAI.ui;
  const LIMIT = 25;

  const state = { offset: 0, noMobile: false };

  /**
   * Masked for display.
   *
   * The API already masks what it must (SRS §16); this only keeps the shape readable enough
   * for an operator to confirm the last four digits against what a farmer reads out.
   */
  function mobileCell(member) {
    if (!member.mobile_no) {
      return '<span class="table__sub">No number</span>';
    }
    return ui.escapeHtml(member.mobile_no);
  }

  function row(member) {
    const unusable = !member.mobile_no;
    return (
      '<tr' +
      (unusable ? ' class="is-blocked"' : '') +
      '>' +
      '<td>' +
      ui.identity(member.member_name, member.father_husband_name) +
      '</td>' +
      '<td><span class="table__code">' +
      ui.escapeHtml(member.member_code) +
      '</span></td>' +
      '<td>' +
      ui.escapeHtml(member.mpp_code || '—') +
      '</td>' +
      '<td>' +
      mobileCell(member) +
      '</td>' +
      '<td>' +
      (unusable
        ? ui.pill('Unusable', 'bad')
        : ui.pill(
            member.activation_status === 'Yes' ? 'Active' : 'Inactive',
            member.activation_status === 'Yes' ? 'good' : null
          )) +
      '</td>' +
      '</tr>'
    );
  }

  function query() {
    const params = { limit: LIMIT, offset: state.offset };
    const search = ($('#search').val() || '').trim();
    const mpp = $('#filter-mpp').val();

    if (search) {
      params.search = search;
    }
    if (mpp) {
      params.mpp__mpp_code = mpp;
    }
    if (state.noMobile) {
      // The server filters on the stored value; an empty string is what an unusable record
      // carries after the SAP import normalises it.
      params.mobile_no = '';
    }
    return params;
  }

  function load() {
    MaitAI.shell.clearAlert();
    MaitAI.api
      .members(query())
      .done(function (page) {
        $('#member-count').text(ui.number(page.count) + ' rows');
        ui.rows($('#rows'), page.results, row, 'No members match that search.', 5);
        ui.pager(
          $('#pager'),
          { count: page.count, limit: LIMIT, offset: state.offset },
          function (offset) {
            state.offset = offset;
            load();
          }
        );

        const unusable = (page.results || []).filter(function (m) {
          return !m.mobile_no;
        }).length;
        $('#unusable-note').text(
          unusable
            ? unusable +
                ' of the members on this page have no usable number and cannot authorise a payment.'
            : ''
        );
      })
      .fail(function (problem) {
        MaitAI.shell.alert(problem.detail);
        ui.rows($('#rows'), [], row, 'Could not load members.', 5);
      });
  }

  function loadMppOptions() {
    MaitAI.api.mpps({ limit: 200 }).done(function (page) {
      $('#filter-mpp').append(
        (page.results || [])
          .map(function (mpp) {
            return (
              '<option value="' +
              ui.escapeHtml(mpp.mpp_code) +
              '">' +
              ui.escapeHtml(mpp.mpp_name) +
              '</option>'
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
    loadMppOptions();
    load();

    let debounce = null;
    $('#search').on('input', function () {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(function () {
        state.offset = 0;
        load();
      }, 350);
    });

    $('#filter-mpp').on('change', function () {
      state.offset = 0;
      load();
    });

    $('#filter-no-mobile').on('click', function () {
      state.noMobile = !state.noMobile;
      state.offset = 0;
      $(this).toggleClass('is-active', state.noMobile).attr('aria-pressed', String(state.noMobile));
      load();
    });

    $('#export').on('click', function () {
      MaitAI.shell.alert('CSV export arrives with the reports screen.', 'warn');
    });
  });
})(window.MaitAI, jQuery);
