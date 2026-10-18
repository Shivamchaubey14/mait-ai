/**
 * Mait activation (W8).
 *
 * 93% of the Mait roster arrives from SAP with no mobile number, and a Mait without one
 * cannot sign in at all (docs/DATA_FINDINGS.md). This screen is how they get one, so it is
 * the gate the whole field rollout passes through.
 *
 * The number is typed twice. It is the only channel into the app — an OTP goes to it and
 * nothing else does — so a single wrong digit sends the sign-in code to a stranger and leaves
 * the Mait permanently locked out, with nothing on any screen to explain why.
 */

(function (MaitAI, $) {
  'use strict';

  const ui = MaitAI.ui;

  const state = { pending: [] };

  function digits(value) {
    return (value || '').replace(/\D/g, '').slice(0, 10);
  }

  function isValidMobile(value) {
    return /^[6-9]\d{9}$/.test(value);
  }

  function selected() {
    const code = $('#sahayak').val();
    return state.pending.filter(function (mait) {
      return mait.sahayak_vendor_code === code;
    })[0];
  }

  function validate() {
    const mobile = digits($('#mobile').val());
    const confirm = digits($('#mobile-confirm').val());
    const chosen = selected();

    const validNumber = isValidMobile(mobile);
    const matches = mobile.length === 10 && mobile === confirm;

    $('#mobile-hint')
      .toggleClass('field__hint--bad', mobile.length === 10 && !validNumber)
      .text(
        mobile.length === 10 && !validNumber
          ? 'Indian mobile numbers start with 6, 7, 8 or 9'
          : 'Checked against every other Mait — no duplicates'
      );

    $('#confirm-hint')
      .toggleClass('field__hint--ok', matches)
      .toggleClass('field__hint--bad', confirm.length === 10 && !matches)
      .text(matches ? 'Matches' : confirm.length === 10 ? 'These do not match' : 'Must match');

    $('#submit').prop('disabled', !(chosen && validNumber && matches));
  }

  /** Name or code contains the typed term — the two things an operator has in hand. */
  function matchesTerm(mait, term) {
    if (!term) {
      return true;
    }
    const t = term.toLowerCase();
    return (
      String(mait.name || '')
        .toLowerCase()
        .indexOf(t) >= 0 ||
      String(mait.sahayak_vendor_code || '')
        .toLowerCase()
        .indexOf(t) >= 0
    );
  }

  /**
   * Fill the dropdown with the pending Maits that match the search box, in name order.
   *
   * The current choice is kept if it still matches, so narrowing the list does not quietly drop
   * the person already picked. `change` is triggered so the replaced control (controls.js) and
   * the form's own validation both see the new state.
   */
  function renderOptions() {
    const term = ($('#mait-search').val() || '').trim();
    const chosen = $('#sahayak').val();

    const matches = state.pending
      .slice()
      .sort(function (a, b) {
        return String(a.name).localeCompare(String(b.name));
      })
      .filter(function (mait) {
        return matchesTerm(mait, term);
      });

    const options = matches.map(function (mait) {
      return (
        '<option value="' +
        ui.escapeHtml(mait.sahayak_vendor_code) +
        '">' +
        ui.escapeHtml(mait.name) +
        ' · ' +
        ui.escapeHtml(mait.sahayak_vendor_code) +
        '</option>'
      );
    });

    let html;
    if (!state.pending.length) {
      html = '<option value="">Nobody is waiting for activation</option>';
    } else if (!options.length) {
      html = '<option value="">No Mait matches that search</option>';
    } else {
      html = '<option value="">Choose a Mait…</option>' + options.join('');
    }
    $('#sahayak').html(html);

    // Keep the person already chosen selected, as long as they are still in the narrowed list.
    if (
      chosen &&
      matches.some(function (mait) {
        return mait.sahayak_vendor_code === chosen;
      })
    ) {
      $('#sahayak').val(chosen);
    }
    $('#sahayak').trigger('change');
  }

  function renderPending(page) {
    state.pending = page.results || [];
    renderOptions();

    const summary = page.summary || {};
    $('#pending-hint').text(
      ui.number(summary.pending_total || 0) +
        ' pending · ' +
        ui.number(summary.without_mobile || 0) +
        ' of them with no number on record'
    );
  }

  function loadRecent() {
    // Maits who already have an account, newest first — the audit of who did what, and the
    // fastest way to spot a number typed into the wrong person.
    MaitAI.api
      .users({ role: 'mait', limit: 10, ordering: '-created_at' })
      .done(function (page) {
        ui.rows(
          $('#recent'),
          page.results,
          function (user) {
            return (
              '<tr>' +
              '<td>' +
              ui.identity(user.mait_name || user.full_name, null) +
              '</td>' +
              '<td><span class="table__code">' +
              ui.escapeHtml(user.sahayak_vendor_code || '—') +
              '</span></td>' +
              '<td>' +
              ui.escapeHtml(user.mobile_no || '—') +
              '</td>' +
              '<td>' +
              ui.dateTime(user.created_at) +
              '</td>' +
              '</tr>'
            );
          },
          'No Maits have been activated yet.',
          4
        );
      })
      .fail(function () {
        ui.rows($('#recent'), [], null, 'Could not load recent activations.', 4);
      });
  }

  $(function () {
    if (!MaitAI.shell.requireSession()) {
      return;
    }
    MaitAI.shell.mount();

    MaitAI.api
      .pendingMaits({ limit: 500 })
      .done(renderPending)
      .fail(function (problem) {
        MaitAI.shell.alert(problem.detail);
      });

    loadRecent();

    // Two layers, so the search is both instant and complete. The client-side filter narrows
    // what is already loaded the moment a key is pressed; the debounced server fetch then brings
    // back every match in the whole backlog, not only the first few hundred that happened to load
    // first — a queue this size does not fit one page.
    let searchTimer = null;
    let searchSeq = 0;
    $('#mait-search').on('input', function () {
      renderOptions();
      const term = ($(this).val() || '').trim();
      window.clearTimeout(searchTimer);
      const mine = (searchSeq += 1);
      searchTimer = window.setTimeout(function () {
        MaitAI.api
          .pendingMaits({ search: term, limit: 500 })
          .done(function (page) {
            // A slow answer for "ram" must not replace a newer list for "ramesh".
            if (mine === searchSeq) {
              renderPending(page);
            }
          })
          .fail(function () {
            // A failed lookup is not a failed screen — the list already loaded can still be used.
          });
      }, 250);
    });

    $('#sahayak').on('change', function () {
      const chosen = selected();
      $('#mpp').val(
        chosen
          ? chosen.mpp_count
            ? chosen.mpp_count + ' MPP(s) assigned in SAP'
            : 'No MPP assigned'
          : ''
      );
      validate();
    });

    $('#mobile, #mobile-confirm').on('input', function () {
      $(this).val(digits($(this).val()));
      validate();
    });

    $('#activate-form').on('submit', function (event) {
      event.preventDefault();
      MaitAI.shell.clearAlert();

      const chosen = selected();
      MaitAI.api
        .activateMait({
          sahayak_vendor_code: chosen.sahayak_vendor_code,
          mobile_no: digits($('#mobile').val()),
        })
        .done(function () {
          $('#activate-form')[0].reset();
          $('#submit').prop('disabled', true);
          MaitAI.shell.alert(
            chosen.name + ' can now sign in. An SMS has gone to the number.',
            'warn'
          );
          MaitAI.api.pendingMaits({ limit: 500 }).done(renderPending);
          loadRecent();
        })
        .fail(function (problem) {
          // The server is the authority on the number being unique across the roster.
          MaitAI.shell.alert(MaitAI.api.problemToLines(problem).join(' · '));
        });
    });
  });
})(window.MaitAI, jQuery);
