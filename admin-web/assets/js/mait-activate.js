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

  function renderPending(page) {
    state.pending = page.results || [];

    // Sorted by MPP so an operator working through one village at a time — which is how the
    // activation backlog is actually cleared — finds them together.
    const options = state.pending
      .slice()
      .sort(function (a, b) {
        return String(a.name).localeCompare(String(b.name));
      })
      .map(function (mait) {
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

    $('#sahayak').html(
      options.length
        ? '<option value="">Choose a Sahayak…</option>' + options.join('')
        : '<option value="">Nobody is waiting for activation</option>'
    );

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
