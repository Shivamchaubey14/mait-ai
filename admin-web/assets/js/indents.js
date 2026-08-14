/**
 * Indents (W13).
 *
 * Two jobs. Watching: surface the failure nothing else will — a request that looks approved
 * but never reached Indent Easy, or was approved a week ago and never issued. Either way a
 * Mait is out of straws and waiting on stock nobody is bringing.
 *
 * And fulfilling. Approve, reject and issue are the manual stand-in for the Indent Easy GRN
 * callback (SRS §6.6.2–6.6.3), which is not built yet — without them an indent raised in the
 * app never leaves `requested`.
 *
 * The panel says what each button will actually do, because they do very different things.
 * Approving records that the office agrees and moves nothing. Issuing sets stock aside
 * against a Mait's name; it becomes theirs when they confirm they collected it. Straw numbers
 * are optional — the ones that matter are read off the straws at the AI step — and filling
 * them in here is for a depot slip that already lists them.
 */

(function (MaitAI, $) {
  'use strict';

  const ui = MaitAI.ui;
  const LIMIT = 25;

  /* Mirrors STALE_AFTER_DAYS in apps/indents/models.py. */
  const STALE_AFTER_DAYS = 3;

  const state = { offset: 0, staleOnly: false, rows: [], selected: null };

  const STATUS_TONE = {
    issued: 'good',
    approved: 'info',
    requested: 'warn',
    rejected: 'bad',
  };

  const SYNC_TONE = { synced: 'good', pending: 'warn', failed: 'bad' };

  /** The status pill's quieter companion: pushed, or not, and whether that failed. */
  function syncPill(indent) {
    return ui.pill(
      indent.sync_status === 'synced' ? 'Synced' : indent.sync_status_display,
      SYNC_TONE[indent.sync_status]
    );
  }

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

  /**
   * The same rule as `stale_indent_q` in the API, which is what `?stale=true` filters on.
   *
   * It has to be the same, because this is what tints the row and prints the pill: a screen
   * that fetched the stale ones and then declined to mark them stale is a screen arguing with
   * itself. Whether the office has approved it yet is not the Mait's problem — an unapproved
   * request that has sat for days is stock nobody is bringing, exactly like an approved one.
   */
  function isStale(indent) {
    if (indent.sync_status === 'failed') {
      return true;
    }
    if (indent.status === 'issued' || indent.status === 'rejected') {
      return false;
    }
    return ui.daysAgo(indent.requested_at) >= STALE_AFTER_DAYS;
  }

  /**
   * The status pill, carrying the half of "issued" the status field does not.
   *
   * `issued` covers two situations that look nothing alike to a Mait: stock set aside at the
   * depot, and stock in their hands. Only the second is in their balance — issuing credits
   * nothing on purpose, `confirm_collection` is what moves it (apps/indents/services.py) — so
   * an admin who issued 25 straws saw a green Issued pill, went looking for the stock on the
   * Inventory screen, and found none of it. The status alone cannot tell them why.
   *
   * Yellow is waiting on somebody everywhere else in this portal, and this is waiting on the
   * Mait. Green is kept for the end of the chain, where the straws are actually theirs.
   */
  function statusPill(indent) {
    if (isStale(indent)) {
      return ui.pill('Stale', 'bad');
    }
    if (indent.status === 'issued') {
      return indent.received_at
        ? ui.pill('Collected', 'good')
        : ui.pill('Awaiting collection', 'warn');
    }
    return ui.pill(indent.status_display, STATUS_TONE[indent.status] || null);
  }

  /** Only the two open states have anything an admin can do to them. */
  function actionCell(indent) {
    if (indent.status === 'requested') {
      return '<button class="btn" type="button" data-open="' + indent.id + '">Review</button>';
    }
    if (indent.status === 'approved') {
      // Labelled for the likely action, not the only one — rejecting is still on the panel.
      return (
        '<button class="btn btn--primary" type="button" data-open="' +
        indent.id +
        '">Issue</button>'
      );
    }
    return '<span class="table__sub">—</span>';
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
      statusPill(indent) +
      '</td>' +
      '<td>' +
      actionCell(indent) +
      '</td>' +
      '</tr>'
    );
  }

  /* --- fulfilment panel ----------------------------------------------------------------- */

  /**
   * Split whatever was pasted into straw numbers.
   *
   * Depot slips arrive as lines, as comma lists and as one long space-separated run, and an
   * operator retyping a paste into the one shape the form wanted is an operator making
   * transcription errors for no reason.
   */
  function parseStrawNumbers(text) {
    return (text || '')
      .split(/[\s,;]+/)
      .map(function (value) {
        return value.trim().toUpperCase();
      })
      .filter(Boolean);
  }

  function closePanel() {
    state.selected = null;
    $('#fulfil').prop('hidden', true);
  }

  function openPanel(indent) {
    state.selected = indent;

    const isStraw = indent.product_type === 'straw';
    const requested = indent.status === 'requested';

    $('#fulfil').prop('hidden', false);
    $('#fulfil-title').text('IND-' + indent.id);
    $('#fulfil-who').text(indent.mait_name + ' · ' + indent.mait_code);
    $('#fulfil-status').html(statusPill(indent) + ' ' + syncPill(indent));
    // The mark takes the colour of the stage, so the panel reads as "a decision" or "a
    // handover" before a word of it has been read.
    $('#fulfil-mark')
      .toggleClass('fulfil__mark--requested', requested)
      .toggleClass('fulfil__mark--approved', !requested);

    // The three facts the decision is about, so an operator is not holding them in their head
    // while they type into the row behind the panel.
    $('#fact-qty').text(ui.number(indent.qty_requested));
    $('#fact-unit').text(isStraw ? 'straws' : 'units');
    $('#fact-item').text(indent.breed || indent.item);
    $('#fact-kind').text(isStraw ? 'Semen straws' : 'Consumable or equipment');
    $('#fact-raised').text(ui.date(indent.requested_at));
    const days = ui.daysAgo(indent.requested_at);
    $('#fact-age').text(days === 0 ? 'today' : days + ' days ago');

    // Approving is only offered on a fresh request; issuing only on an approved one. But an
    // approved indent can still be declined — stock runs out between the office agreeing and
    // the depot packing, and an approved request nobody can fulfil looks like stock coming.
    $('#field-reason').prop('hidden', false);
    $('#do-approve').prop('hidden', !requested);
    $('#do-reject').prop('hidden', false);

    // Quantity is the normal way in, for straws as much as for sheaths. The numbers box is
    // there for a depot slip that already lists them.
    $('#field-qty').prop('hidden', requested);
    $('#field-straws').prop('hidden', requested || !isStraw);
    $('#do-issue').prop('hidden', requested);

    // Says what the buttons will actually do. Approving moves nothing; issuing sets stock
    // aside against a Mait's name, and that is worth stating rather than inferring.
    $('#fulfil-effect').toggleClass('fulfil__effect--decide', requested);
    $('#fulfil-effect-text').text(
      requested
        ? 'Approving moves no stock — it records that the office agrees. Rejecting closes the request, and the Mait reads your reason.'
        : 'Issuing sets this stock aside for ' +
            indent.mait_name +
            '. It becomes theirs when they confirm they have collected it.'
    );

    $('#straw-numbers').val('');
    $('#reject-reason').val('');
    $('#issue-qty').val(indent.qty_requested);
    $('#qty-hint').text(indent.qty_requested + ' requested. Issue fewer if that is what went.');
    updateHint();

    $('#fulfil')[0].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    (requested ? $('#reject-reason') : isStraw ? $('#straw-numbers') : $('#issue-qty')).trigger(
      'focus'
    );
  }

  /** Counts as they type, because "25 straws" is the thing being got right. */
  function updateHint() {
    const indent = state.selected;
    if (!indent) {
      return;
    }
    if (indent.status === 'requested') {
      $('#fulfil-hint').text('Approving moves no stock. Issue it once the straws change hands.');
      return;
    }
    if (indent.product_type !== 'straw') {
      $('#fulfil-hint').text('Credits ' + indent.mait_name + ' directly.');
      return;
    }

    const numbers = parseStrawNumbers($('#straw-numbers').val());
    const duplicates = numbers.length !== new Set(numbers).size;

    $('#straw-hint')
      .toggleClass('field__hint--bad', duplicates || numbers.length > indent.qty_requested)
      .toggleClass('field__hint--ok', !duplicates && numbers.length > 0)
      .text(
        duplicates
          ? 'The same number is listed twice — each straw is one physical object'
          : numbers.length
            ? numbers.length + ' entered — this sets the quantity'
            : 'Leave blank to issue by quantity — the Mait records each number as they use it'
      );

    $('#straw-count').text(numbers.length ? numbers.length + ' listed' : 'optional');

    // Listing numbers is the more specific instruction, so it wins and says so rather than
    // silently disagreeing with the box above it.
    $('#issue-qty').prop('disabled', numbers.length > 0);
    $('#fulfil-hint').text(
      numbers.length
        ? 'Issuing the ' + numbers.length + ' straws listed below.'
        : 'Issued as a quantity. Each number is recorded when the Mait uses that straw.'
    );
    $('#do-issue').prop('disabled', duplicates);
  }

  function afterAction(message) {
    closePanel();
    MaitAI.shell.alert(message, 'warn');
    load();
  }

  function failed(problem) {
    // The server owns every rule that matters here — a straw already held, a state that
    // cannot be issued from. Show what it said rather than guessing in the client.
    MaitAI.shell.alert(MaitAI.api.problemToLines(problem).join(' · '));
  }

  function busy(on) {
    $('#do-approve, #do-reject, #do-issue').prop('disabled', on);
    if (!on) {
      updateHint();
    }
  }

  /* --- loading -------------------------------------------------------------------------- */

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
        state.rows = page.results || [];
        const stale = state.rows.filter(isStale).length;
        const open = state.rows.filter(function (indent) {
          return indent.status === 'requested' || indent.status === 'approved';
        }).length;
        $('#indent-count').text(
          ui.number(page.count) +
            ' indents · ' +
            open +
            ' awaiting you on this page' +
            (stale ? ' · ' + stale + ' stale' : '')
        );
        ui.rows($('#rows'), state.rows, row, 'No indents match these filters.', 7);
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
        ui.rows($('#rows'), [], row, 'Could not load indents.', 7);
      });
  }

  $(function () {
    if (!MaitAI.shell.requireSession()) {
      return;
    }
    MaitAI.shell.mount();

    // Arrived from the Stale indents card. The chip is switched on rather than the sort being
    // applied invisibly, so the screen shows which filter it is under and the operator can
    // turn it off from where they are standing.
    if (MaitAI.shell.param('stale')) {
      state.staleOnly = true;
      $('#filter-stale').addClass('is-active').attr('aria-pressed', 'true');
    }
    const status = MaitAI.shell.param('status');
    if (status) {
      $('#filter-status').val(status);
    }

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
      closePanel();
      load();
    });

    $('#filter-stale').on('click', function () {
      state.staleOnly = !state.staleOnly;
      state.offset = 0;
      closePanel();
      $(this)
        .toggleClass('is-active', state.staleOnly)
        .attr('aria-pressed', String(state.staleOnly));
      load();
    });

    // Delegated: the table is re-rendered on every load and pager click.
    $('#rows').on('click', '[data-open]', function () {
      const id = Number($(this).data('open'));
      const indent = state.rows.filter(function (row_) {
        return row_.id === id;
      })[0];
      if (indent) {
        MaitAI.shell.clearAlert();
        openPanel(indent);
      }
    });

    $('#straw-numbers').on('input', updateHint);
    $('#do-close').on('click', closePanel);

    $('#do-approve').on('click', function () {
      const indent = state.selected;
      busy(true);
      MaitAI.api
        .approveIndent(indent.id)
        .done(function () {
          afterAction('IND-' + indent.id + ' approved. Issue it once the stock changes hands.');
        })
        .fail(failed)
        .always(function () {
          busy(false);
        });
    });

    $('#do-reject').on('click', function () {
      const indent = state.selected;
      const reason = ($('#reject-reason').val() || '').trim();
      if (!reason) {
        // Not enforced by the API, asked for here: "rejected" with no explanation is a phone
        // call to the office from a Mait who cannot work.
        $('#fulfil-hint').text('Give a reason — the Mait sees only this.');
        $('#reject-reason').trigger('focus');
        return;
      }
      busy(true);
      MaitAI.api
        .rejectIndent(indent.id, reason)
        .done(function () {
          afterAction('IND-' + indent.id + ' rejected. The Mait can read the reason.');
        })
        .fail(failed)
        .always(function () {
          busy(false);
        });
    });

    $('#do-issue').on('click', function () {
      const indent = state.selected;
      const numbers = parseStrawNumbers($('#straw-numbers').val());
      const qty = numbers.length || Number($('#issue-qty').val());

      if (
        !window.confirm(
          'Credit ' +
            qty +
            ' to ' +
            indent.mait_name +
            '?\n\nThis adds to their stock immediately. Only do it for goods that have ' +
            'physically changed hands.'
        )
      ) {
        return;
      }

      busy(true);
      MaitAI.api
        .issueIndent(indent.id, numbers.length ? { straw_numbers: numbers } : { qty: qty })
        .done(function (issued) {
          afterAction(
            'IND-' +
              indent.id +
              ' issued · ' +
              issued.qty_issued +
              ' credited to ' +
              indent.mait_name
          );
        })
        .fail(failed)
        .always(function () {
          busy(false);
        });
    });
  });
})(window.MaitAI, jQuery);
