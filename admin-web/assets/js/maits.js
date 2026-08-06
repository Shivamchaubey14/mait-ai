/**
 * Maits (W7).
 *
 * The roster as SAP has it, activated or not. 93% arrive with no mobile number and cannot
 * sign in, so this screen is mostly a backlog: its job is to make the size of that backlog
 * impossible to miss and to route the operator into the activation queue.
 *
 * A Mait with no number is shown, not filtered away. They are the work.
 */

(function (MaitAI, $) {
  'use strict';

  const ui = MaitAI.ui;
  const LIMIT = 25;

  const state = { offset: 0, needsMobile: false, pendingOnly: false };

  function statusCell(mait) {
    if (!mait.is_active) {
      return ui.pill('Inactive in SAP', null);
    }
    if (mait.needs_mobile) {
      return ui.pill('Needs mobile', 'bad');
    }
    if (!mait.activated) {
      return ui.pill('Not activated', 'warn');
    }
    return ui.pill('Active', 'good');
  }

  function row(mait) {
    const cls = mait.needs_mobile
      ? ' class="is-blocked"'
      : !mait.activated
        ? ' class="is-waiting"'
        : '';
    return (
      '<tr' +
      cls +
      '>' +
      '<td>' +
      ui.identity(mait.name, null) +
      '</td>' +
      '<td><span class="table__code">' +
      ui.escapeHtml(mait.sahayak_vendor_code) +
      '</span></td>' +
      '<td>' +
      (mait.mpp_count
        ? ui.escapeHtml(mait.mpp_codes.slice(0, 3).join(', ')) +
          (mait.mpp_count > 3
            ? ' <span class="table__sub">+' + (mait.mpp_count - 3) + ' more</span>'
            : '')
        : '<span class="table__sub">None assigned</span>') +
      '</td>' +
      '<td>' +
      (mait.mobile_no ? ui.escapeHtml(mait.mobile_no) : '<span class="table__sub">Not set</span>') +
      '</td>' +
      '<td>' +
      statusCell(mait) +
      '</td>' +
      '</tr>'
    );
  }

  function query() {
    const params = { limit: LIMIT, offset: state.offset };
    const search = ($('#search').val() || '').trim();
    if (search) {
      params.search = search;
    }
    if (state.needsMobile) {
      params.needs_mobile = 'true';
    }
    if (state.pendingOnly) {
      params.activated = 'false';
    }
    return params;
  }

  function load() {
    MaitAI.shell.clearAlert();
    MaitAI.api
      .maitRoster(query())
      .done(function (page) {
        const summary = page.summary || {};
        $('#mait-count').text(ui.number(summary.total || page.count));

        // The proportion, not just the count: "1,099 of 1,183" is a rollout problem, "1,099"
        // on its own is a number.
        if (summary.without_mobile) {
          const percent = Math.round((summary.without_mobile / summary.total) * 100);
          $('#backlog-title').text(
            ui.number(summary.without_mobile) +
              ' of ' +
              ui.number(summary.total) +
              ' Maits (' +
              percent +
              '%) arrived from SAP with no mobile number'
          );
          $('#backlog').prop('hidden', false);
        } else {
          $('#backlog').prop('hidden', true);
        }

        ui.rows($('#rows'), page.results, row, 'No Maits match these filters.', 5);
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
        ui.rows($('#rows'), [], row, 'Could not load the roster.', 5);
      });
  }

  $(function () {
    if (!MaitAI.shell.requireSession()) {
      return;
    }
    MaitAI.shell.mount();
    load();

    let debounce = null;
    $('#search').on('input', function () {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(function () {
        state.offset = 0;
        load();
      }, 350);
    });

    $('#filter-needs-mobile').on('click', function () {
      state.needsMobile = !state.needsMobile;
      state.offset = 0;
      $(this)
        .toggleClass('is-active', state.needsMobile)
        .attr('aria-pressed', String(state.needsMobile));
      load();
    });

    $('#filter-pending').on('click', function () {
      state.pendingOnly = !state.pendingOnly;
      state.offset = 0;
      $(this)
        .toggleClass('is-active', state.pendingOnly)
        .attr('aria-pressed', String(state.pendingOnly));
      load();
    });
  });
})(window.MaitAI, jQuery);
