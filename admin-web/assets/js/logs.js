/**
 * Audit log (W19).
 *
 * This platform has been writing an audit trail since its first commit — thirty-six call
 * sites — and until now the only way to read one was a Django shell. SRS §7 asks for
 * auditability and §16 for a record of who reads personal data; a table nobody can open
 * satisfies an auditor on paper and nobody in practice.
 *
 * **A row is a sentence, not a schema.** The API builds "Completed AI event 64" out of the
 * action, the record and whichever metadata key holds the outcome; this screen shows that
 * line and keeps the rest folded away underneath. A log that makes its reader assemble the
 * meaning from four columns and a JSON blob is one they stop opening.
 *
 * **Personal data is the row that matters.** An Aadhaar card opened, an export of bank
 * details taken — those are the entries an auditor scrolls for, so they are the only red ones
 * and they have a tile and a chip of their own. Everything else here is ordinary work and is
 * drawn as ordinary work.
 */

(function (MaitAI, $) {
  'use strict';

  const ui = MaitAI.ui;
  const shell = MaitAI.shell;

  const PAGE = 50;

  const state = { offset: 0, action: '', entity: '', search: '', from: '', to: '', rows: [] };

  function filters() {
    const query = { limit: PAGE, offset: state.offset };
    if (state.action) {
      query.action = state.action;
    }
    if (state.entity) {
      query.entity_type = state.entity;
    }
    if (state.search) {
      query.search = state.search;
    }
    if (state.from) {
      query.date_from = state.from;
    }
    if (state.to) {
      query.date_to = state.to;
    }
    return query;
  }

  function anyFilter() {
    return !!(state.action || state.entity || state.search || state.from || state.to);
  }

  /** "3 minutes ago", "yesterday" — the half of a timestamp somebody actually reads. */
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
    if (days === 1) {
      return 'yesterday';
    }
    return days + ' days ago';
  }

  /**
   * The actor, as a disc of initials beside their name.
   *
   * A trail is scanned down the Who column looking for one person, and a column of names in
   * one weight is a column that has to be read word by word. The disc gives the eye something
   * to match on. `System` — a scheduled job, a webhook — is deliberately grey rather than
   * given a colour of its own: it is the absence of a person, not another person.
   */
  function actor(who) {
    return (
      '<span class="log__actor">' +
      '<span class="log__avatar' +
      (who.system ? ' log__avatar--system' : '') +
      '" aria-hidden="true">' +
      ui.escapeHtml(who.initials) +
      '</span>' +
      '<span>' +
      ui.identity(who.name, who.role) +
      '</span></span>'
    );
  }

  function row(entry) {
    const openable = entry.facts.length || entry.changes.length;
    return (
      '<tr class="log__row' +
      (openable ? ' is-openable' : '') +
      '" data-id="' +
      entry.id +
      '"' +
      (openable ? ' tabindex="0"' : '') +
      '>' +
      '<td class="log__when">' +
      ui.escapeHtml(ui.dateTime(entry.when)) +
      '<span class="table__sub">' +
      ui.escapeHtml(relative(entry.when)) +
      '</span></td>' +
      '<td>' +
      actor(entry.actor) +
      '</td>' +
      '<td class="log__what"><div class="log__what-line">' +
      (openable
        ? '<span class="log__chevron" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
          'stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6" /></svg>' +
          '</span>'
        : '<span class="log__chevron log__chevron--none" aria-hidden="true"></span>') +
      '<span>' +
      ui.pill(entry.action_label, entry.tone) +
      ' <span class="log__summary">' +
      ui.escapeHtml(entry.summary) +
      '</span></span>' +
      '</div></td>' +
      '<td class="log__record">' +
      ui.escapeHtml(entry.entity_label) +
      '<span class="table__sub">' +
      ui.escapeHtml(entry.entity_id) +
      '</span></td>' +
      '<td class="log__code">' +
      ui.escapeHtml(entry.ip_address || '—') +
      '</td>' +
      '</tr>'
    );
  }

  function detail(entry) {
    // A real before/after where the call site recorded one, struck through on the left the
    // way a diff reads. Most entries have none — the trail is mostly facts, not edits.
    const changes = entry.changes.length
      ? '<div class="log__changes">' +
        entry.changes
          .map(function (change) {
            return (
              '<div class="log__change">' +
              '<span class="log__field">' +
              ui.escapeHtml(change.field) +
              '</span>' +
              '<span class="log__from">' +
              ui.escapeHtml(change.from || 'empty') +
              '</span>' +
              '<span class="log__arrow" aria-hidden="true">→</span>' +
              '<span class="log__to">' +
              ui.escapeHtml(change.to || 'empty') +
              '</span></div>'
            );
          })
          .join('') +
        '</div>'
      : '';

    const facts = entry.facts.length
      ? '<dl class="log__facts">' +
        entry.facts
          .map(function (fact) {
            return (
              '<div class="log__fact"><dt>' +
              ui.escapeHtml(fact.label) +
              '</dt><dd>' +
              ui.escapeHtml(fact.value) +
              '</dd></div>'
            );
          })
          .join('') +
        '</dl>'
      : '';

    // The thread that ties one act together: two entries sharing a request id happened in the
    // same request, which is how a state change and the payment behind it are shown to be one
    // thing rather than two. Clicking it searches for its siblings.
    const trace = entry.request_id
      ? '<p class="log__trace">Request ' +
        '<button class="log__trace-id" type="button" data-request="' +
        ui.escapeHtml(entry.request_id) +
        '">' +
        ui.escapeHtml(entry.request_id) +
        '</button>' +
        ' — everything else recorded in the same request</p>'
      : '';

    return (
      '<tr class="log__detail"><td colspan="5"><div class="log__panel">' +
      changes +
      facts +
      trace +
      '</div></td></tr>'
    );
  }

  function drawActions(facets) {
    const chips = [{ key: '', label: 'All actions', tone: null, count: null }].concat(
      facets.actions || []
    );
    $('#actions').html(
      chips
        .map(function (chip) {
          return (
            '<button class="chip' +
            (chip.tone ? ' chip--' + chip.tone : '') +
            (chip.key === state.action ? ' is-active' : '') +
            '" type="button" data-action="' +
            ui.escapeHtml(chip.key) +
            '" aria-pressed="' +
            (chip.key === state.action) +
            '">' +
            ui.escapeHtml(chip.label) +
            (chip.count === null ? '' : ' <small>' + ui.number(chip.count) + '</small>') +
            '</button>'
          );
        })
        .join('')
    );
  }

  function drawEntities(facets) {
    const chosen = state.entity;
    $('#entity').html(
      ['<option value="">All record types</option>']
        .concat(
          (facets.entity_types || []).map(function (item) {
            return (
              '<option value="' +
              ui.escapeHtml(item.key) +
              '"' +
              (item.key === chosen ? ' selected' : '') +
              '>' +
              ui.escapeHtml(item.label) +
              ' (' +
              ui.number(item.count) +
              ')</option>'
            );
          })
        )
        .join('')
    );
    if (MaitAI.controls) {
      MaitAI.controls.sync('#entity');
    }
  }

  function drawSummary(summary) {
    $('[data-kpi="total"]').text(ui.number(summary.total));
    $('[data-kpi="total-foot"]').text('in the last ' + summary.window_days + ' days');
    $('[data-kpi="today"]').text(ui.number(summary.today));
    $('[data-kpi="people"]').text(ui.number(summary.people));
    $('[data-kpi="pii"]').text(ui.number(summary.pii_access));
  }

  function load() {
    shell.clearAlert();
    $('#rows').attr('aria-busy', 'true');
    $('#clear').prop('hidden', !anyFilter());

    MaitAI.api
      .auditTrail(filters())
      .done(function (data) {
        state.rows = data.results || [];
        drawSummary(data.summary || {});
        drawActions(data.facets || {});
        drawEntities(data.facets || {});

        $('#count').text(ui.number(data.count) + (data.count === 1 ? ' entry' : ' entries'));
        ui.rows(
          $('#rows'),
          state.rows,
          row,
          anyFilter() ? 'Nothing in the trail matches that.' : 'Nothing has been recorded yet.',
          5
        );
        ui.pager(
          $('#pager'),
          { count: data.count, limit: data.limit, offset: data.offset },
          function (offset) {
            state.offset = offset;
            load();
            // Back to the top of the table: a pager at the foot of fifty rows leaves the
            // reader looking at row fifty of the next page.
            $('.log__table')[0].scrollIntoView({ block: 'start' });
          }
        );
      })
      .fail(function (problem) {
        shell.alert(problem.detail);
        ui.rows($('#rows'), [], row, 'Could not load the trail.', 5);
        $('#pager').empty();
      });
  }

  /**
   * Take the trail away as a workbook.
   *
   * **The filters go, the paging does not.** `limit` and `offset` are how this table pages,
   * not part of the question being asked, and passing them would hand back the fifty rows
   * that happened to be on screen — a file that looks complete, is not, and says nothing
   * about it. The server has its own ceiling for the genuinely enormous case and the file
   * says on its cover when that ceiling bit.
   *
   * **The button says what it is doing, because this wait is real.** An xlsx is a zip: it
   * cannot be valid until its central directory is written, so the server has to finish
   * building before it can send a byte, and on a wide date range that is most of the wait.
   * `api.download` reports that as its own phase, so a button reading "Preparing…" and then
   * counting up is telling the truth about two different things rather than sitting at zero
   * looking broken.
   *
   * Worth knowing while reading this: fetching the file appends to the thing being fetched.
   * The server records the export as a personal-data read before building, so the trail
   * reloaded after a download is one row longer — which is the point of a trail, not a bug.
   */
  function exportWorkbook() {
    shell.clearAlert();

    const query = filters();
    delete query.limit;
    delete query.offset;

    const $label = $('#export-label');
    $('#export').prop('disabled', true);

    MaitAI.api
      .auditTrailExport(query, function (update) {
        if (update.phase === 'preparing') {
          $label.text('Preparing…');
        } else if (update.phase === 'receiving') {
          // No percentage where the server sent no `Content-Length`. Guessing a total and
          // then revising it is what makes a counter run to the end and jump back.
          $label.text(
            update.fraction === null
              ? 'Downloading…'
              : 'Downloading… ' + Math.round(update.fraction * 100) + '%'
          );
        }
      })
      .then(function () {
        // Reloaded rather than left alone: the export just wrote a row to the trail, and a
        // screen still showing the state from before it is a screen that disagrees with the
        // file the operator is holding.
        load();
      })
      .catch(function () {
        shell.alert('The workbook could not be produced. Try a narrower date range.');
      })
      .finally(function () {
        $('#export').prop('disabled', false);
        $label.text('Export workbook');
      });
  }

  /** Any filter change starts from the first page — page four of the old result is nothing. */
  function refilter() {
    state.offset = 0;
    load();
  }

  function toggle($row) {
    const open = $row.hasClass('is-open');
    $('.log__row').removeClass('is-open');
    $('.log__detail').remove();
    if (open || !$row.hasClass('is-openable')) {
      return;
    }
    const entry = state.rows.filter(function (item) {
      return item.id === Number($row.data('id'));
    })[0];
    if (entry) {
      $row.addClass('is-open').after(detail(entry));
    }
  }

  $(function () {
    if (!shell.requireSession()) {
      return;
    }
    shell.mount();
    load();

    $('#refresh').on('click', load);
    $('#export').on('click', exportWorkbook);

    $('#clear').on('click', function () {
      state.action = '';
      state.entity = '';
      state.search = '';
      state.from = '';
      state.to = '';
      $('#search').val('');
      $('#date-from, #date-to').val('');
      $('#entity').val('');
      if (MaitAI.controls) {
        MaitAI.controls.sync('#entity, #date-from, #date-to');
      }
      refilter();
    });

    $('#actions').on('click', '.chip[data-action]', function () {
      state.action = $(this).attr('data-action') || '';
      refilter();
    });

    $('#entity').on('change', function () {
      state.entity = $(this).val() || '';
      refilter();
    });

    $('#date-from, #date-to').on('change', function () {
      state.from = $('#date-from').val() || '';
      state.to = $('#date-to').val() || '';
      refilter();
    });

    // Typed at, not typed into: a trail of a hundred thousand rows is a server-side search,
    // and one request per keystroke is one request per keystroke.
    let typing = null;
    $('#search').on('input', function () {
      const value = $(this).val() || '';
      window.clearTimeout(typing);
      typing = window.setTimeout(function () {
        state.search = value.trim();
        refilter();
      }, 300);
    });

    $('#rows').on('click', '.log__row', function () {
      toggle($(this));
    });
    $('#rows').on('keydown', '.log__row', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle($(this));
      }
    });

    // Following a request id is a search for it, so the filter bar shows what is being asked
    // rather than the screen entering a mode nothing on it explains.
    $('#rows').on('click', '.log__trace-id', function (event) {
      event.stopPropagation();
      const id = $(this).attr('data-request');
      $('#search').val(id);
      state.search = id;
      state.action = '';
      refilter();
    });
  });
})(window.MaitAI, jQuery);
