/**
 * Indents (W13).
 *
 * Fulfilment happens in Indent Easy, not here (SRS §6.6.2–6.6.3), so this screen is watching
 * rather than doing. Its job is to surface the one failure that nothing else will: a request
 * that looks approved but never reached Indent Easy, or was approved a week ago and never
 * issued. Either way a Mait is out of straws and waiting on stock nobody is bringing.
 */

(function (MaitAI, $) {
  'use strict';

  const ui = MaitAI.ui;
  const LIMIT = 25;

  const state = { offset: 0, staleOnly: false };

  const STATUS_TONE = {
    issued: 'good',
    approved: 'info',
    requested: 'warn',
    rejected: 'bad',
  };

  const SYNC_TONE = { synced: 'good', pending: 'warn', failed: 'bad' };

  function syncCell(indent) {
    const label =
      indent.sync_status === 'synced'
        ? 'Synced' + (indent.indent_easy_ref_no ? ' · ' + indent.indent_easy_ref_no : '')
        : indent.sync_status_display;
    return (
      ui.pill(label, SYNC_TONE[indent.sync_status]) +
      (indent.sync_status === 'failed' && indent.last_sync_error
        ? '<span class="table__sub">' + ui.escapeHtml(indent.last_sync_error) + '</span>'
        : '')
    );
  }

  function ageCell(indent) {
    const days = ui.daysAgo(indent.requested_at);
    return (
      ui.date(indent.requested_at) +
      '<span class="table__sub">' +
      (days === 0 ? 'today' : days + 'd ago') +
      '</span>'
    );
  }

  function isStale(indent) {
    return (
      indent.sync_status === 'failed' ||
      (indent.status === 'approved' && ui.daysAgo(indent.requested_at) >= 7)
    );
  }

  function row(indent) {
    const stale = isStale(indent);
    return (
      '<tr' +
      (stale ? ' class="is-blocked"' : indent.status === 'requested' ? ' class="is-waiting"' : '') +
      '>' +
      '<td><span class="table__code">IND-' +
      indent.id +
      '</span></td>' +
      '<td>' +
      ui.identity(indent.mait_name, indent.mait_code) +
      '</td>' +
      '<td>' +
      ui.escapeHtml(indent.item) +
      (indent.qty_issued
        ? '<span class="table__sub">' + indent.qty_issued + ' issued</span>'
        : '') +
      '</td>' +
      '<td>' +
      ageCell(indent) +
      '</td>' +
      '<td>' +
      syncCell(indent) +
      '</td>' +
      '<td>' +
      ui.pill(stale ? 'Stale' : indent.status_display, stale ? 'bad' : STATUS_TONE[indent.status]) +
      '</td>' +
      '</tr>'
    );
  }

  function query() {
    const params = { limit: LIMIT, offset: state.offset };
    const search = ($('#search').val() || '').trim();
    const status = $('#filter-status').val();
    const sync = $('#filter-sync').val();

    if (search) {
      params.search = search;
    }
    if (status) {
      params.status = status;
    }
    if (sync) {
      params.sync_status = sync;
    }
    if (state.staleOnly) {
      params.stale = 'true';
    }
    return params;
  }

  function load() {
    MaitAI.shell.clearAlert();
    MaitAI.api
      .indents(query())
      .done(function (page) {
        const stale = (page.results || []).filter(isStale).length;
        $('#indent-count').text(
          ui.number(page.count) + ' indents' + (stale ? ' · ' + stale + ' stale on this page' : '')
        );
        ui.rows($('#rows'), page.results, row, 'No indents match these filters.', 6);
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
        ui.rows($('#rows'), [], row, 'Could not load indents.', 6);
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

    $('#filter-status, #filter-sync').on('change', function () {
      state.offset = 0;
      load();
    });

    $('#filter-stale').on('click', function () {
      state.staleOnly = !state.staleOnly;
      state.offset = 0;
      $(this)
        .toggleClass('is-active', state.staleOnly)
        .attr('aria-pressed', String(state.staleOnly));
      load();
    });
  });
})(window.MaitAI, jQuery);
