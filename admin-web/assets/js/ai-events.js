/**
 * AI events list (W5).
 *
 * The one table that answers "what happened in the field today". Every row is one
 * insemination, so the columns are chosen to be triaged without opening anything: who it was
 * for, who did it, whether the money landed, and what state it is in.
 *
 * Search is debounced rather than fired per keystroke — the table behind it is 31,000 rows
 * and this runs on back-office connections.
 */

(function (MaitAI, $) {
  'use strict';

  const ui = MaitAI.ui;
  const LIMIT = 25;

  const state = { offset: 0, count: 0 };

  // Deleting an event is admin-only (the API gates it to super_admin / admin, matching
  // `IsAdmin`). The tick column and the bar over a selection exist only to drive that one
  // write, so for anyone else — including an account that has merely been *assigned* the AI
  // Events section — they are not rendered at all: no empty column, no button that only ever
  // returns 403. Set once at init from the profile cached at sign-in.
  let canDelete = false;

  function readCanDelete() {
    const profile = MaitAI.api.profile.get();
    const role = profile && profile.role;
    return role === 'super_admin' || role === 'admin';
  }

  // The office-side completion is the same back-office correction delete is, so the same admins
  // get it — super_admin / admin, never a Normal User — and the API gates it to exactly that set
  // (CanDeleteAIEvent). `canComplete` mirrors `canDelete`; it is named apart so the two reasons a
  // row sprouts a control stay legible even though the role test is the one test.
  let canComplete = false;

  // A row the office may close: a member's capture the Mait left at photo_captured or
  // payment_pending whose ₹100 deduction is already recorded and verified. A non-member is left
  // out — she authorises her own payment with a code the office cannot enter — as is any event
  // whose payment has not landed, which is finance's to record, not this button's to assume. The
  // server enforces every one of these; this only decides whether to draw the button.
  function completable(event) {
    return (
      canComplete &&
      event.owner_type === 'member' &&
      (event.status === 'photo_captured' || event.status === 'payment_pending') &&
      !!event.payment &&
      event.payment.is_verified === true
    );
  }

  function completeButton(event) {
    return (
      '<button class="btn btn--warn js-complete" type="button" data-complete="' +
      event.id +
      '" aria-label="Complete event ' +
      event.id +
      '">Complete</button>'
    );
  }

  /**
   * Status colours match the app exactly.
   *
   * A Mait and an admin looking at the same event must see the same colour, because field
   * users learn colour faster than they learn labels (tokens.css).
   */
  const STATUS_TONE = {
    completed: 'good',
    payment_pending: 'warn',
    photo_captured: 'info',
    straw_verified: 'info',
    draft: null,
    cancelled: 'bad',
  };

  // The capture states that still need the Mait who started them — a record standing between
  // an animal that has been served and a line that says so. Kept in step with the server's
  // own `AIEvent.UNFINISHED_STATUSES`, which the `unfinished` filter is defined from: completed
  // and cancelled are terminal, everything else is a Mait to ring.
  const UNFINISHED = {
    draft: true,
    straw_verified: true,
    photo_captured: true,
    payment_pending: true,
  };

  function paymentCell(payment) {
    if (!payment) {
      // Normal, not missing: the event has not reached step 6 yet.
      return '<span class="table__sub">Not yet taken</span>';
    }
    const label = ui.money(payment.amount) + ' ' + (payment.mode || '').toLowerCase();
    if (payment.status === 'failed') {
      return label + '<span class="table__sub">Failed</span>';
    }
    if (!payment.is_verified) {
      return label + '<span class="table__sub">Awaiting confirmation</span>';
    }
    return label;
  }

  function animalCell(event) {
    const type = event.animal_type === 'BUFF' ? 'Buffalo' : 'Cow';
    return type + ' · ' + ui.escapeHtml(event.breed || '—');
  }

  /**
   * Her other member codes, under her name — the same SAP vendor at another MPP.
   *
   * A member who moves MPP is given a new code and keeps her vendor, so an event recorded under
   * her old code names a code nobody uses any more, and one under her new code hides that she
   * has a history. The other code is named, with which way round it is: "Now …" where the
   * other code is the active one, "Earlier code …" where it is not.
   */
  function otherCodes(event) {
    const others = event.other_member_codes || [];
    if (!others.length) {
      return '';
    }
    return others
      .map(function (other) {
        return (
          '<a class="table__sub table__moved" href="member.html?code=' +
          encodeURIComponent(other.member_code) +
          '" title="' +
          ui.escapeHtml((other.mpp_name || '') + ' (' + (other.mpp_code || '') + ')') +
          '">' +
          (other.current ? 'Now ' : 'Earlier code ') +
          ui.escapeHtml(other.member_code) +
          '</a>'
        );
      })
      .join('');
  }

  /**
   * Her milk procurement and whether it clears the insemination-code bar.
   *
   * The same note the Super OTP screen shows, brought under the farmer here so an admin reading
   * the event can see at a glance whether the member is eligible — a code is recovered from her
   * milk payout, so "eligible" means she has poured enough to cover the AI charge.
   *
   * Shown only once the gate is live (`p.gated`): a dairy that has uploaded no procurement has
   * no bar to read against, so the row stays as it was. Empty for a non-member, whose event
   * carries no procurement at all (she pays the Mait in cash).
   */
  function procurementNote(p) {
    if (!p || !p.gated) {
      return '';
    }
    const eligible = p.eligible;
    const bar = '₹' + Math.round(parseFloat(p.threshold || 0));
    let poured;
    if (p.amount === null || p.amount === undefined) {
      poured = 'no milk on record';
    } else {
      poured = '₹' + Math.round(parseFloat(p.amount)) + ' poured';
      if (p.period && p.period.qty) {
        poured += ' · ' + parseFloat(p.period.qty).toFixed(1) + ' L';
      }
    }
    return (
      '<div class="table__sub">' +
      ui.pill(eligible ? 'Eligible' : 'Not eligible', eligible ? 'good' : 'bad') +
      ' · ' +
      ui.escapeHtml(poured) +
      ' · bar ' +
      ui.escapeHtml(bar) +
      '</div>'
    );
  }

  function row(event) {
    // Anything waiting on a human is tinted, so a screenful can be triaged without reading
    // every status cell. Every unfinished capture is tinted, not only the payment-pending one
    // it used to be: a straw verified days ago and never photographed is just as stuck, and
    // the whole point of this screen is to spot it.
    const rowClass = UNFINISHED[event.status]
      ? ' class="is-waiting"'
      : event.status === 'cancelled'
        ? ' class="is-blocked"'
        : '';

    return (
      '<tr' +
      rowClass +
      '>' +
      '<td class="col-pick">' +
      (canDelete
        ? '<input class="pick" type="checkbox" value="' +
          event.id +
          '" aria-label="Select event ' +
          event.id +
          '" />'
        : '') +
      '</td>' +
      '<td><a class="table__code" href="ai-event.html?id=' +
      event.id +
      '">' +
      event.id +
      '</a></td>' +
      '<td>' +
      ui.identity(
        event.owner_name,
        event.owner_type === 'member'
          ? (event.member_code ? event.member_code + ' · ' : '') + event.mpp_code
          : 'Non-member'
      ) +
      otherCodes(event) +
      procurementNote(event.procurement) +
      '</td>' +
      '<td>' +
      ui.identity(event.mait_name, event.mait_code, {
        title: event.mait_name,
        detail: event.mait_mobile,
      }) +
      '</td>' +
      '<td>' +
      animalCell(event) +
      '</td>' +
      '<td>' +
      paymentCell(event.payment) +
      '</td>' +
      '<td>' +
      // The day the event is dated to, the same one the dashboard counts it on: its
      // completion for a finished capture, or when it was started while it is still
      // unfinished. Dating the row by `created_at` alone made this screen disagree with the
      // dashboard by one whenever a capture crossed midnight between starting and finishing.
      ui.dateTime(event.completed_at || event.created_at) +
      '</td>' +
      '<td>' +
      ui.pill(event.status_display, STATUS_TONE[event.status]) +
      '</td>' +
      // The one write this column drives: Complete, on a stuck member capture only. Empty on
      // every other row rather than absent, so the column lines up — and collapsed entirely for
      // anyone who is not an admin (table--no-actions), exactly as the tick column is.
      '<td class="table__action">' +
      (completable(event) ? completeButton(event) : '') +
      '</td>' +
      '</tr>'
    );
  }

  /**
   * A worked example, shown only when there is genuinely nothing and nothing is filtered.
   *
   * Seven empty columns describe nothing. On a fresh install — which this screen has to survive,
   * because no AI event can complete until payments land — "No events match these filters" is
   * both true and useless, so the table shows what a day's work looks like instead.
   *
   * Unmistakably not data: the head says Sample, the rows are greyed, and the event codes are
   * not links. The moment one real row exists it replaces the lot, and it never appears while a
   * filter is set, because there "nothing matches" is the answer.
   */
  const SAMPLE = [
    [
      'AI-100482',
      'KAVITA DEVI',
      'MPP000412',
      'SUNITA DEVI',
      '5500000054',
      'Cow · GIR',
      '₹ 300 upi',
      '12 Aug 2026, 08:14',
      'Completed',
      'good',
      '',
    ],
    [
      'AI-100481',
      'RADHA SINGH',
      'MPP000188',
      'RAMESH KUMAR',
      '5500000091',
      'Buffalo · MURRAH',
      '₹ 300 cash',
      '12 Aug 2026, 07:52',
      'Completed',
      'good',
      '',
    ],
    [
      'AI-100479',
      'MEENA KUMARI',
      'MPP000412',
      'SUNITA DEVI',
      '5500000054',
      'Cow · HF CROSS',
      '₹ 300 upi',
      '11 Aug 2026, 17:30',
      'Payment pending',
      'warn',
      ' class="is-waiting"',
    ],
    [
      'AI-100476',
      'SHANTI DEVI',
      'Non-member',
      'ANIL SINGH',
      '5500000117',
      'Cow · GIR',
      'Not yet taken',
      '11 Aug 2026, 16:05',
      'Straw verified',
      'info',
      '',
    ],
    [
      'AI-100470',
      'PUSHPA DEVI',
      'MPP000188',
      'RAMESH KUMAR',
      '5500000091',
      'Buffalo · MURRAH',
      'Not yet taken',
      '11 Aug 2026, 09:41',
      'Cancelled',
      'bad',
      ' class="is-blocked"',
    ],
  ];

  function sampleRow(r) {
    const money =
      r[6].indexOf('Not yet') === 0 ? '<span class="table__sub">' + r[6] + '</span>' : r[6];
    return (
      '<tr' +
      r[10] +
      '>' +
      // An empty tick cell, so the sample lines up with real rows without offering a checkbox
      // over data that is not there.
      '<td class="col-pick"></td>' +
      '<td><span class="table__code">' +
      ui.escapeHtml(r[0]) +
      '</span></td>' +
      '<td>' +
      ui.identity(r[1], r[2]) +
      '</td>' +
      '<td>' +
      ui.identity(r[3], r[4]) +
      '</td>' +
      '<td>' +
      ui.escapeHtml(r[5]) +
      '</td>' +
      '<td>' +
      money +
      '</td>' +
      '<td>' +
      ui.escapeHtml(r[7]) +
      '</td>' +
      '<td>' +
      ui.pill(r[8], r[9]) +
      '</td>' +
      // The sample is never acted on, so its action cell is empty — present only to line the
      // row up with the real ones under the same column count.
      '<td class="table__action"></td>' +
      '</tr>'
    );
  }

  /** True when the Unfinished chip is pressed. */
  function unfinishedOn() {
    return $('#filter-unfinished').attr('aria-pressed') === 'true';
  }

  /** True when nothing is narrowing the list, so "nothing here" means nothing exists. */
  function unfiltered() {
    return (
      !($('#search').val() || '').trim() &&
      !$('#filter-status').val() &&
      !$('#filter-mpp').val() &&
      !$('#filter-from').val() &&
      !$('#filter-to').val() &&
      !unfinishedOn()
    );
  }

  function showSample() {
    $('#events').addClass('events--sample');
    $('#events-note').html('<span class="events__badge">Sample — no events recorded yet</span>');
    $('#rows').removeAttr('aria-busy').html(SAMPLE.map(sampleRow).join(''));
    // The sample carries no checkboxes, so nothing can be selected — make sure the bar is down.
    renderBulk();
  }

  function query() {
    const params = { limit: LIMIT, offset: state.offset };
    const status = $('#filter-status').val();
    const mpp = $('#filter-mpp').val();
    const from = $('#filter-from').val();
    const to = $('#filter-to').val();
    const search = ($('#search').val() || '').trim();

    if (search) {
      params.search = search;
    }
    if (status) {
      params.status = status;
    }
    if (mpp) {
      params.mpp = mpp;
    }
    if (from) {
      params.date_from = from;
    }
    if (to) {
      params.date_to = to;
    }
    // The server decides what "unfinished" means (its UNFINISHED_STATUSES), so the screen asks
    // for the set by name rather than listing the statuses itself. Left off when a specific
    // status is chosen: the two would AND, and "photo captured AND unfinished" is just a
    // longer way to narrow to one box the dropdown already covers.
    if (unfinishedOn() && !status) {
      params.unfinished = true;
    }
    return params;
  }

  /**
   * Export what is on the screen.
   *
   * It was a stub saying the export "arrives with the reports screen" — which it did, on a
   * different screen, and left an operator who had already built the query here to rebuild it
   * there. The endpoint takes the same filters this list does, so the file can simply be the
   * list.
   *
   * **`limit` and `offset` are dropped on the way out.** They are how this table pages, not
   * part of the query, and passing them through would hand back the twenty-five rows that
   * happened to be on screen — a file that looks complete, is not, and says nothing about it.
   * The endpoint has its own ceiling for the genuinely enormous case.
   *
   * The fetch-as-blob dance lives in `api.download`: these endpoints stream and need the
   * bearer token, and a plain link arrives unauthenticated.
   */
  function exportWorkbook() {
    MaitAI.shell.clearAlert();

    const params = query();
    delete params.limit;
    delete params.offset;
    const search = $.param(params);

    $('#export').prop('disabled', true);
    $('#export-label').text('Preparing…');

    MaitAI.api
      .download('/reports/export/' + (search ? '?' + search : ''), 'ai-events.xlsx')
      .catch(function () {
        MaitAI.shell.alert('The export could not be produced. Try a narrower date range.');
      })
      .finally(function () {
        $('#export').prop('disabled', false);
        $('#export-label').text('Export Excel');
      });
  }

  /* --- selecting and deleting rows -----------------------------------------------------
   * Deleting is the one write this screen allows, and only for an admin — the API enforces
   * that, so this is simply the control that drives it. The tick column and the bar over a
   * selection are the same shape the Users screen uses for its bulk action.
   */
  function picked() {
    return $('#rows .pick:checked')
      .map(function () {
        return Number(this.value);
      })
      .get();
  }

  /** The header tick reflects the rows: all, none, or the in-between state. */
  function syncPickAll() {
    const $boxes = $('#rows .pick');
    const $on = $('#rows .pick:checked');
    const all = $boxes.length > 0 && $on.length === $boxes.length;
    $('#pick-all')
      .prop('checked', all)
      .prop('indeterminate', $on.length > 0 && !all);
  }

  /** Show or hide the bar, and count what is in it. Called after every selection and reload. */
  function renderBulk() {
    const ids = picked();
    if (!ids.length) {
      $('#bulk').prop('hidden', true);
      $('#bulk-status').text('');
      syncPickAll();
      return;
    }
    $('#bulk-count').text(ids.length + (ids.length === 1 ? ' event' : ' events') + ' selected');
    $('#bulk-delete').text('Delete ' + ids.length);
    $('#bulk').prop('hidden', false);
    syncPickAll();
  }

  function setBulkBusy(busy) {
    $('#bulk-delete, #bulk-clear, #pick-all').prop('disabled', busy);
    $('#rows .pick').prop('disabled', busy);
  }

  /**
   * Delete the ticked events, after one deliberate confirmation.
   *
   * The whole selection goes in one request — the server removes them in a single transaction,
   * so it is all or nothing rather than a half-finished delete to puzzle over. On success the
   * list is reloaded from the first page: a destructive action should land somewhere known, and
   * the rows that were on screen are gone.
   */
  function runDelete() {
    const ids = picked();
    if (!ids.length) {
      return;
    }
    if (
      !window.confirm(
        'Delete ' +
          ids.length +
          (ids.length === 1 ? ' event' : ' events') +
          '? This removes the record, its payment and its pregnancy checks, and cannot be undone.'
      )
    ) {
      return;
    }

    setBulkBusy(true);
    $('#bulk-status').text('Deleting…');

    MaitAI.api
      .bulkDeleteAiEvents(ids)
      .done(function (result) {
        const n = (result && result.deleted_count) || ids.length;
        state.offset = 0;
        load(n + (n === 1 ? ' event deleted.' : ' events deleted.'));
      })
      .fail(function (problem) {
        setBulkBusy(false);
        $('#bulk-status').text('');
        MaitAI.shell.alert(problem.detail);
      });
  }

  /* --- completing a stuck capture from the office --------------------------------------
   * The office's one door into completion — the Mait's own is barred to an admin on purpose.
   * It is the same thing the handset would do: deduct the straw and close the event, and book
   * the pregnancy check that follows. One deliberate confirm, because it moves inventory, and
   * the server refuses anything that is not a member capture with its payment already verified.
   */
  function runComplete(id, $btn) {
    if (
      !window.confirm(
        'Complete event ' +
          id +
          "? This deducts the straw from the Mait's stock, records the insemination as done " +
          'and books its pregnancy check.'
      )
    ) {
      return;
    }

    $btn.prop('disabled', true).text('Completing…');

    MaitAI.api
      .officeCompleteAiEvent(id)
      .done(function () {
        // Land on the reloaded list: the row now reads Completed and has lost its button, which
        // is the confirmation. The flash says which one, since the page may have moved.
        load('Event ' + id + ' completed.');
      })
      .fail(function (problem) {
        $btn.prop('disabled', false).text('Complete');
        MaitAI.shell.alert(problem.detail);
      });
  }

  /**
   * @param {string} [flash] a success line to show once the reloaded list has rendered. Set by
   *   a delete; left off by the pager and the filters, which have nothing to announce.
   */
  function load(flash) {
    MaitAI.shell.clearAlert();
    MaitAI.api
      .aiEvents(query())
      .done(function (page) {
        state.count = page.count;
        const summary = page.summary || {};
        $('#event-count').text(ui.number(page.count) + ' events');
        if (flash) {
          MaitAI.shell.alert(flash, 'good');
        }

        // The Unfinished chip carries how many captures in this view still wait on a Mait, so
        // an admin can see at a glance that there are any — and click to list them. It is also
        // what reconciles this screen with the dashboard: the dashboard counts the completed,
        // and the unfinished are the difference.
        const unfinishedN = summary.unfinished || 0;
        $('#unfinished-count')
          .text(ui.number(unfinishedN))
          .prop('hidden', !unfinishedN || unfinishedOn());

        // An empty unfiltered list is a screen nobody can read. Anything else — including a
        // filter that matches nothing — is a result, and gets said plainly.
        if (!page.count && unfiltered()) {
          showSample();
          $('#pager').empty();
          return;
        }

        $('#events').removeClass('events--sample');
        // The count, then its status split (what the dashboard counts vs what is still open),
        // then how many of the page are on screen. The split is left off when the Unfinished
        // chip is already pressed — the whole list is unfinished there, so it says nothing.
        const parts = [ui.number(page.count) + (unfinishedOn() ? ' unfinished' : ' matching')];
        if (!unfinishedOn()) {
          const split = [];
          if (summary.completed) {
            split.push(ui.number(summary.completed) + ' completed');
          }
          if (summary.unfinished) {
            split.push(ui.number(summary.unfinished) + ' unfinished');
          }
          if (summary.cancelled) {
            split.push(ui.number(summary.cancelled) + ' cancelled');
          }
          if (split.length) {
            parts.push(split.join(' · '));
          }
        }
        parts.push('showing ' + (page.results || []).length);
        $('#events-note').text(parts.join(' · '));
        ui.rows($('#rows'), page.results, row, 'No events match these filters.', 9);
        // The table was just rebuilt, so nothing is ticked any more and the bar must say so.
        renderBulk();
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
        ui.rows($('#rows'), [], row, 'Could not load events.', 9);
        renderBulk();
      });
  }

  function loadMppOptions() {
    MaitAI.api.mpps({ limit: 200 }).done(function (page) {
      const options = (page.results || []).map(function (mpp) {
        return (
          '<option value="' +
          ui.escapeHtml(mpp.mpp_code) +
          '">' +
          ui.escapeHtml(mpp.mpp_name) +
          '</option>'
        );
      });
      $('#filter-mpp').append(options.join(''));
    });
  }

  $(function () {
    if (!MaitAI.shell.requireSession()) {
      return;
    }
    MaitAI.shell.mount();
    loadMppOptions();

    // Decide before the first render, so the tick column is never drawn for someone who cannot
    // use it. `table--no-pick` collapses that column (header and body alike) for non-admins.
    canDelete = readCanDelete();
    // Same admins, same gate (the API's is CanDeleteAIEvent for both). Draw neither column for
    // anyone else: the tick column collapses, and so does the Complete column.
    canComplete = canDelete;
    if (!canDelete) {
      $('.table').addClass('table--no-pick');
    }
    if (!canComplete) {
      $('.table').addClass('table--no-actions');
    }

    // Arrived from a queue card on Exceptions or the dashboard. Set the control rather than
    // filtering behind its back: the operator has to be able to see why this list is short,
    // and to widen it without going back the way they came. An unknown value leaves the select
    // alone, so a mistyped URL shows everything rather than nothing.
    const status = MaitAI.shell.param('status');
    if (status) {
      $('#filter-status').val(status);
    }

    // Arrived from a "stuck events" link (e.g. the dashboard): open straight onto the
    // unfinished set. A status in the URL wins, since it is the more specific request.
    const unfinished = MaitAI.shell.param('unfinished');
    if (!status && (unfinished === '1' || unfinished === 'true')) {
      $('#filter-unfinished').attr('aria-pressed', 'true').addClass('is-active');
    }

    load();

    $('#filter-status, #filter-mpp, #filter-from, #filter-to').on('change', function () {
      // A chosen status is the more specific answer, so picking one releases the Unfinished
      // chip rather than fighting it — otherwise the two AND to a confusing near-empty list.
      if (this.id === 'filter-status' && $(this).val()) {
        $('#filter-unfinished').attr('aria-pressed', 'false').removeClass('is-active');
      }
      state.offset = 0;
      load();
    });

    // One click to every capture that stopped partway, and where it stopped. Clears any single
    // status first — the chip asks for the whole unfinished set, which a lone status contradicts.
    $('#filter-unfinished').on('click', function () {
      const on = $(this).attr('aria-pressed') !== 'true';
      $(this).attr('aria-pressed', String(on)).toggleClass('is-active', on);
      if (on) {
        $('#filter-status').val('');
      }
      state.offset = 0;
      load();
    });

    // Server-side search across 31,000 events is not free, and neither is a rural office
    // connection. Wait until the operator stops typing.
    let debounce = null;
    $('#search').on('input', function () {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(function () {
        state.offset = 0;
        load();
      }, 350);
    });

    $('#export').on('click', exportWorkbook);

    /* --- bulk selection and delete -------------------------------------------------------- */
    // Wired only for an admin: for everyone else the controls are not on the page, so there is
    // nothing to bind and no path to the delete call.
    if (canDelete) {
      // Delegated: the table is rebuilt on every load and pager click.
      $('#rows').on('change', '.pick', renderBulk);

      $('#pick-all').on('change', function () {
        $('#rows .pick').prop('checked', $(this).is(':checked'));
        renderBulk();
      });

      $('#bulk-clear').on('click', function () {
        $('#rows .pick').prop('checked', false);
        renderBulk();
      });

      $('#bulk-delete').on('click', runDelete);
    }

    // The per-row Complete button, for the same admins. Delegated, because the table is rebuilt
    // on every load and pager click. Only rendered on an eligible row, so the handler is only
    // ever reached for one — and the server is the real gate behind it.
    if (canComplete) {
      $('#rows').on('click', '.js-complete', function () {
        const $btn = $(this);
        runComplete(Number($btn.data('complete')), $btn);
      });
    }
  });
})(window.MaitAI, jQuery);
