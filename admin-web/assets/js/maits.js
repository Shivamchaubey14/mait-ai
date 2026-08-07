/**
 * Maits (W7).
 *
 * The roster as SAP has it, activated or not. Maits arriving with no mobile number cannot
 * sign in, so this screen is mostly a backlog: its job is to make the size of that backlog
 * impossible to miss and to route the operator into the activation queue.
 *
 * A Mait with no number is shown, not filtered away. They are the work.
 */

(function (MaitAI, $) {
  'use strict';

  const ui = MaitAI.ui;
  const LIMIT = 25;

  const state = { offset: 0, rows: [], needsMobile: false, pendingOnly: false };

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
      '<td><button class="btn" type="button" data-edit="' +
      ui.escapeHtml(mait.sahayak_vendor_code) +
      '">Edit</button></td>' +
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
        const total = summary.total || page.count || 0;
        const stranded = summary.without_mobile || 0;
        state.rows = page.results || [];
        $('#mait-count').text(ui.number(total));

        // Nothing to say when nobody is stranded — a standing warning over an empty backlog
        // is the kind of banner people learn to scroll past.
        //
        // Worded to scale when there is. "1,099 of 1,183" is a rollout problem; "1 Mait" is a
        // phone call, and dressing the second up as the first spends the alarm on nothing.
        if (stranded && total) {
          const percent = Math.round((stranded / total) * 100);
          $('#backlog-title').text(
            stranded === 1
              ? 'One Mait has no mobile number'
              : ui.number(stranded) +
                  ' of ' +
                  ui.number(total) +
                  ' Maits (' +
                  percent +
                  '%) have no mobile number'
          );
          $('#backlog').prop('hidden', false);
        } else {
          $('#backlog').prop('hidden', true);
        }

        ui.rows($('#rows'), state.rows, row, 'No Maits match these filters.', 6);
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
        ui.rows($('#rows'), [], row, 'Could not load the roster.', 6);
      });
  }

  $(function () {
    if (!MaitAI.shell.requireSession()) {
      return;
    }
    MaitAI.shell.mount();
    // Same editor the Assignment screen opens, so a row is corrected the same way wherever
    // the operator happens to be standing.
    MaitAI.maitEditor.mount('#mait-editor', function (saved) {
      MaitAI.shell.alert(saved.name + ' saved.', 'warn');
      load();
    });
    load();

    // Delegated: the table is rebuilt on every load and pager click.
    $('#rows').on('click', '[data-edit]', function () {
      MaitAI.shell.clearAlert();
      const code = String($(this).data('edit'));
      MaitAI.maitEditor.open(
        state.rows.filter(function (mait) {
          return mait.sahayak_vendor_code === code;
        })[0]
      );
    });

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
