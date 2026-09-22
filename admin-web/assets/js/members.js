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
 *
 * **The number is the one field an Admin changes here.** It is where payment and verification
 * codes go, so the change asks for a reason, shows what it will do before it is saved, and
 * says whose number it is replacing. A number the office sets is marked *Office* on the row and
 * is kept when the member master is uploaded again — the server refuses to let SAP take it
 * back. The dialog sends the number it was opened on, so two admins on one member are one
 * change and one clear refusal rather than the second silently undoing the first.
 */

(function (MaitAI, $) {
  'use strict';

  const ui = MaitAI.ui;
  const LIMIT = 25;

  const state = {
    offset: 0,
    noMobile: false,
    office: false,
    page: [],
    editing: null,
    // Whether the server sent the masked Aadhaar at all — an Admin's list only.
    aadhaar: false,
  };

  const SHIELD =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6zM9 12l2 2 4-4" /></svg>';

  /** `98123 45678` — the way a number is read out over the phone. */
  function spaced(digits) {
    return digits && digits.length === 10 ? digits.slice(0, 5) + ' ' + digits.slice(5) : digits;
  }

  /** The server's rule, echoed so the dialog can say "not a number" before a round trip. */
  function normalise(value) {
    let raw = String(value || '').replace(/[\s-]/g, '');
    if (raw.indexOf('+91') === 0) {
      raw = raw.slice(3);
    } else if (raw.indexOf('91') === 0 && raw.length === 12) {
      raw = raw.slice(2);
    }
    return /^[6-9]\d{9}$/.test(raw) ? raw : '';
  }

  /** Who set a number, and when — the line a protected number carries. */
  function setBy(member) {
    if (member.mobile_source !== 'office') {
      return 'From the SAP master';
    }
    return (
      'Set by ' +
      (member.mobile_updated_by_name || 'the office') +
      (member.mobile_updated_at ? ' on ' + ui.date(member.mobile_updated_at) : '')
    );
  }

  const EYE =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6" /></svg>';

  const CARD =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8.5 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4M5.5 16a3 3 0 0 1 6 0M14 9h4M14 13h4" /></svg>';

  /** How long a revealed Aadhaar stays on screen before it masks itself again. */
  const REVEAL_MS = 30000;

  /** `1234 5678 9012`, the way the card prints it. */
  function grouped(digits) {
    return String(digits || '')
      .replace(/\D/g, '')
      .replace(/(\d{4})(?=\d)/g, '$1 ');
  }

  /**
   * The Aadhaar: masked to its last four, with **Show** for the whole number.
   *
   * The list is sent masked (SRS §16). Show asks the server for this one member's number,
   * which it logs against the operator's account, so an Admin on the phone can check that the
   * caller is who they say they are. It masks itself again after thirty seconds — a screen
   * left open on a shared desk should not keep a stranger's identity number up. The column
   * exists only for an account the server sends it to.
   */
  function aadhaarCell(member) {
    const masked = member.aadhar_masked || '';
    if (!masked) {
      return '<span class="member-aadhaar member-aadhaar--none">' + CARD + 'Not on file</span>';
    }
    return (
      '<span class="member-aadhaar" data-aadhaar-cell="' +
      ui.escapeHtml(member.member_code) +
      '">' +
      CARD +
      '<span class="member-aadhaar__number">XXXX XXXX ' +
      ui.escapeHtml(masked.slice(-4)) +
      '</span>' +
      '<button class="member-aadhaar__show" type="button" data-reveal="' +
      ui.escapeHtml(member.member_code) +
      '" title="Show the full number — the view is logged">' +
      EYE +
      'Show</button></span>'
    );
  }

  function reveal($button) {
    const code = String($button.data('reveal'));
    const $cell = $button.closest('[data-aadhaar-cell]');
    $button.prop('disabled', true).text('…');
    MaitAI.api
      .memberAadhaar(code)
      .done(function (body) {
        const member = state.page.filter(function (m) {
          return m.member_code === code;
        })[0];
        $cell
          .addClass('is-revealed')
          .html(
            CARD +
              '<span class="member-aadhaar__number">' +
              ui.escapeHtml(grouped(body.aadhar_no)) +
              '</span>' +
              '<button class="member-aadhaar__show" type="button" data-hide="' +
              ui.escapeHtml(code) +
              '">Hide</button>'
          );
        // Masked again on its own, however the operator leaves the screen.
        window.setTimeout(function () {
          if (member && $cell.hasClass('is-revealed')) {
            $cell.replaceWith(aadhaarCell(member));
          }
        }, REVEAL_MS);
      })
      .fail(function (problem) {
        $button.prop('disabled', false).html(EYE + 'Show');
        MaitAI.shell.alert(
          problem.status === 429
            ? 'Too many Aadhaar numbers opened this hour. Try again later.'
            : problem.detail
        );
      });
  }

  function mobileCell(member) {
    if (!member.mobile_no) {
      return '<span class="table__sub">No number</span>';
    }
    return (
      '<span class="member-mobile">' +
      '<span class="member-mobile__number">' +
      ui.escapeHtml(spaced(member.mobile_no)) +
      '</span>' +
      (member.mobile_source === 'office'
        ? '<span class="member-mobile__office" title="' +
          ui.escapeHtml(setBy(member) + ' — kept when the member master is re-uploaded') +
          '">' +
          SHIELD +
          'Office</span>'
        : '') +
      '</span>'
    );
  }

  function row(member) {
    const unusable = !member.mobile_no;
    return (
      '<tr' +
      (unusable ? ' class="is-blocked"' : '') +
      ' data-code="' +
      ui.escapeHtml(member.member_code) +
      '">' +
      '<td>' +
      ui.identity(member.member_name, member.father_husband_name) +
      '</td>' +
      '<td><span class="table__code">' +
      ui.escapeHtml(member.member_code) +
      '</span></td>' +
      '<td>' +
      ui.escapeHtml(member.mpp_code || '—') +
      '</td>' +
      (state.aadhaar ? '<td>' + aadhaarCell(member) + '</td>' : '') +
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
      '<td class="table__action"><button class="btn btn--warn" type="button" data-phone="' +
      ui.escapeHtml(member.member_code) +
      '">' +
      (unusable ? 'Add number' : 'Change number') +
      '</button></td>' +
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
    if (state.office) {
      params.mobile_source = 'office';
    }
    return params;
  }

  /** `keepAlert` after a save, so the refreshed list does not wipe the line saying it saved. */
  function load(keepAlert) {
    if (!keepAlert) {
      MaitAI.shell.clearAlert();
    }
    MaitAI.api
      .members(query())
      .done(function (page) {
        state.page = page.results || [];
        state.aadhaar = state.page.some(function (m) {
          return Object.prototype.hasOwnProperty.call(m, 'aadhar_masked');
        });
        $('.aadhaar-col').prop('hidden', !state.aadhaar);
        const columns = state.aadhaar ? 7 : 6;
        $('#member-count').text(ui.number(page.count) + ' rows');
        ui.rows($('#rows'), state.page, row, 'No members match that search.', columns);
        ui.pager(
          $('#pager'),
          { count: page.count, limit: LIMIT, offset: state.offset },
          function (offset) {
            state.offset = offset;
            load();
          }
        );

        const unusable = state.page.filter(function (m) {
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
        ui.rows($('#rows'), [], row, 'Could not load members.', state.aadhaar ? 7 : 6);
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

  /* --- the dialog ------------------------------------------------------------------------ */

  function renderHistory(rows) {
    $('#phone-history').html(
      rows.length
        ? rows
            .map(function (change) {
              return (
                '<li class="phone__change">' +
                '<span class="phone__change-dot" aria-hidden="true"></span>' +
                '<div class="phone__change-body">' +
                '<p class="phone__change-what"><span>' +
                ui.escapeHtml(change.before || 'no number') +
                '</span> → <strong>' +
                ui.escapeHtml(change.after) +
                '</strong></p>' +
                '<p class="phone__change-meta">' +
                ui.escapeHtml(ui.date(change.when)) +
                (change.by ? ' · ' + ui.escapeHtml(change.by) : '') +
                (change.reason ? ' · “' + ui.escapeHtml(change.reason) + '”' : '') +
                '</p></div></li>'
              );
            })
            .join('')
        : '<li class="phone__empty">Never changed by the office — this is SAP’s number.</li>'
    );
  }

  /**
   * What saving will do, in one sentence, before it is done: green when it is ready, red when
   * the server would refuse it, quiet until there is something to say.
   */
  function renderPreview() {
    const member = state.editing;
    if (!member) {
      return;
    }
    const typed = ($('#phone-new').val() || '').trim();
    const next = normalise(typed);
    const reason = ($('#phone-reason').val() || '').trim();
    const $preview = $('#phone-preview');
    let tone = 'quiet';
    let html = 'Type the new number and say why, and this says what saving will do.';
    let ok = false;

    $('#phone-new-hint')
      .text(
        typed && !next
          ? 'Not a mobile number — 10 digits, starting with 6, 7, 8 or 9'
          : '10 digits, starting with 6, 7, 8 or 9'
      )
      .toggleClass('field__hint--bad', Boolean(typed && !next));

    if (typed && !next) {
      tone = 'bad';
      html = 'That is not a 10-digit Indian mobile number.';
    } else if (next && next === (member.mobile_no || '')) {
      tone = 'bad';
      html = 'That is already the number on file.';
    } else if (next && reason.length < 4) {
      tone = 'warn';
      html = 'Say why it is changing — it is kept in the audit log.';
    } else if (next) {
      tone = 'good';
      ok = true;
      html =
        (member.mobile_no
          ? '<span class="phone__from">' + ui.escapeHtml(spaced(member.mobile_no)) + '</span> → '
          : 'Adds ') +
        '<strong>' +
        ui.escapeHtml(spaced(next)) +
        '</strong> for ' +
        ui.escapeHtml(member.member_name) +
        '. ' +
        SHIELD +
        ' Kept when the member master is uploaded again.';
    }
    $preview.attr('class', 'phone__preview phone__preview--' + tone).html(html);
    $('#phone-save').prop('disabled', !ok);
  }

  function openDialog(member) {
    state.editing = member;
    $('#phone-meta').text(member.member_name + ' · ' + member.member_code);
    $('#phone-current').text(member.mobile_no ? spaced(member.mobile_no) : 'No number');
    $('#phone-source').html(
      member.mobile_source === 'office'
        ? '<span class="member-mobile__office">' + SHIELD + ui.escapeHtml(setBy(member)) + '</span>'
        : '<span class="phone__sap">From the SAP master</span>'
    );
    $('#phone-new, #phone-reason').val('');
    $('#phone-status').text('');
    $('#phone-history').html('<li class="phone__empty">Loading…</li>');
    renderPreview();
    document.getElementById('phone').showModal();
    $('#phone-new').trigger('focus');

    MaitAI.api
      .memberMobileHistory(member.member_code)
      .done(function (body) {
        renderHistory(body.results || []);
      })
      .fail(function () {
        $('#phone-history').html('<li class="phone__empty">Could not load the history.</li>');
      });
  }

  function closeDialog() {
    state.editing = null;
    document.getElementById('phone').close();
  }

  function save(event) {
    event.preventDefault();
    const member = state.editing;
    const next = normalise($('#phone-new').val());
    if (!member || !next) {
      return;
    }
    $('#phone-save, #phone-cancel').prop('disabled', true);
    $('#phone-status').text('Saving…');

    MaitAI.api
      .changeMemberMobile(member.member_code, {
        mobile_no: next,
        reason: ($('#phone-reason').val() || '').trim(),
        // The number this dialog was opened on: if a colleague changed it since, the server
        // refuses rather than letting this save silently undo their correction.
        expected_mobile: member.mobile_no || '',
      })
      .done(function (body) {
        closeDialog();
        const shared = body.shared_with || [];
        MaitAI.shell.alert(
          member.member_name +
            '’s number is now ' +
            spaced(body.member.mobile_no) +
            ', and SAP uploads will keep it.' +
            (shared.length
              ? ' Note: ' +
                shared
                  .map(function (other) {
                    return other.member_name + ' (' + other.member_code + ')';
                  })
                  .join(', ') +
                ' is on the same number.'
              : ''),
          shared.length ? 'warn' : 'good'
        );
        load(true);
      })
      .fail(function (problem) {
        $('#phone-status').text('Not saved.');
        MaitAI.shell.alert(MaitAI.api.problemToLines(problem).join(' · '));
        if (problem.status === 409) {
          // Somebody else changed it: close, and show the list as it now stands.
          closeDialog();
          load(true);
        }
      })
      .always(function () {
        $('#phone-save, #phone-cancel').prop('disabled', false);
        renderPreview();
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

    $('#filter-office').on('click', function () {
      state.office = !state.office;
      state.offset = 0;
      $(this).toggleClass('is-active', state.office).attr('aria-pressed', String(state.office));
      load();
    });

    $('#rows').on('click', '[data-reveal]', function () {
      reveal($(this));
    });
    $('#rows').on('click', '[data-hide]', function () {
      const code = String($(this).data('hide'));
      const member = state.page.filter(function (m) {
        return m.member_code === code;
      })[0];
      if (member) {
        $(this).closest('[data-aadhaar-cell]').replaceWith(aadhaarCell(member));
      }
    });

    $('#rows').on('click', '[data-phone]', function () {
      const code = String($(this).data('phone'));
      const member = state.page.filter(function (m) {
        return m.member_code === code;
      })[0];
      if (member) {
        openDialog(member);
      }
    });

    $('#phone-new, #phone-reason').on('input', renderPreview);
    $('#phone-reasons').on('click', '[data-reason]', function () {
      $('#phone-reason').val($(this).data('reason'));
      renderPreview();
    });
    $('#phone-form').on('submit', save);
    $('#phone-close, #phone-cancel').on('click', closeDialog);
    $('#phone').on('close', function () {
      state.editing = null;
    });

    $('#export').on('click', function () {
      MaitAI.shell.alert('CSV export arrives with the reports screen.', 'warn');
    });
  });
})(window.MaitAI, jQuery);
