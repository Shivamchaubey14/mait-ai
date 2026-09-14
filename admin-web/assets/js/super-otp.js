/**
 * Login codes (W22).
 *
 * When the SMS gateway is not delivering, every step that sends a code stops: signing in, the
 * farmer check, and her authorising a payment. At each, the app offers to ask the office; the
 * ask lands here with the step it is for; an admin generates a one-time code and reads it out
 * on the phone — to the account holder for sign-in, and to *the farmer* for her steps, never
 * to the Mait who asked. She tells the Mait the code, exactly as she would have read the SMS.
 *
 * The screen is built around the one way this can go wrong: somebody who is not the account
 * holder ringing the office for a code. So the number on the row is the number *on file*, the
 * reveal says to call it, and the code is shown once and never again. The last SMS column is
 * the other half of the judgement — a code that the gateway says it delivered two minutes ago
 * is a reason to ask them to look at their messages first.
 *
 * Refreshed every twenty seconds while it is open: the asks arrive from the field, and an
 * admin watching the screen should not have to reload it to see the one that just came in.
 */

(function (MaitAI, $) {
  'use strict';

  const ui = MaitAI.ui;
  const api = MaitAI.api;
  const REFRESH_MS = 20000;

  const state = { rows: [], scope: 'open', term: '', revealTimer: null };

  const STATE_PILL = {
    waiting: ['Waiting for a call', 'warn'],
    issued: ['Code given', 'info'],
    used: ['Used', 'good'],
    expired: ['Code expired', null],
    locked: ['Too many wrong tries', 'bad'],
    declined: ['Declined', null],
    revoked: ['Replaced', null],
    lapsed: ['Nobody answered it', null],
  };

  function clock(iso) {
    if (!iso) {
      return '—';
    }
    const d = new Date(iso);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  /** "4 min ago", "2 h ago", then the date — how long somebody has been waiting. */
  function ago(iso) {
    if (!iso) {
      return '—';
    }
    const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (minutes < 1) {
      return 'just now';
    }
    if (minutes < 60) {
      return minutes + ' min ago';
    }
    if (minutes < 24 * 60) {
      return Math.round(minutes / 60) + ' h ago';
    }
    return ui.date(iso);
  }

  function smsCell(sms) {
    if (!sms) {
      return '<span class="table__sub">No SMS sent yet</span>';
    }
    const line = sms.delivered
      ? '<span class="sms-good">Gateway sent it ' + clock(sms.sent_at) + '</span>'
      : '<span class="sms-bad">Not delivered · ' + clock(sms.sent_at) + '</span>';
    return (
      line +
      '<span class="table__sub">' +
      sms.sent_last_hour +
      ' sent in the last hour' +
      (sms.verified ? ' · last one was used' : '') +
      '</span>'
    );
  }

  function askedCell(row) {
    if (!row.requested_at) {
      return '<span class="table__sub">Phoned the office</span>';
    }
    return (
      ago(row.requested_at) +
      (row.request_count > 1 ? ' · asked ' + row.request_count + '×' : '') +
      (row.reason ? '<span class="table__sub">“' + ui.escapeHtml(row.reason) + '”</span>' : '')
    );
  }

  function stateCell(row) {
    const pill = STATE_PILL[row.state] || [row.status_display, null];
    let sub = '';
    if (row.state === 'issued') {
      sub =
        'by ' +
        ui.escapeHtml(row.issued_by_name || '—') +
        ' at ' +
        clock(row.issued_at) +
        ' · until ' +
        clock(row.expires_at) +
        (row.attempt_count ? ' · ' + row.attempt_count + ' wrong' : '');
    } else if (row.state === 'used') {
      sub = 'at ' + clock(row.used_at);
    } else if (row.state === 'declined' && row.decline_reason) {
      sub = ui.escapeHtml(row.decline_reason);
    }
    return ui.pill(pill[0], pill[1]) + (sub ? '<span class="table__sub">' + sub + '</span>' : '');
  }

  function actionCell(row) {
    if (row.state === 'waiting') {
      return (
        '<div class="otp-actions">' +
        '<button class="btn btn--primary" type="button" data-issue="' +
        row.id +
        '">Generate code</button>' +
        '<button class="btn" type="button" data-decline="' +
        row.id +
        '">Decline</button></div>'
      );
    }
    // Only sign-in is remade by number: a farmer's code belongs to the farmer and the payment
    // on the Mait's screen, and a fresh one is asked for from there.
    if (
      !row.for_farmer &&
      (row.state === 'issued' || row.state === 'expired' || row.state === 'locked')
    ) {
      // A new code for the same person: the old one is revoked by the server as it is made.
      return (
        '<button class="btn" type="button" data-again="' +
        ui.escapeHtml(row.number_on_file) +
        '">New code</button>'
      );
    }
    return '<span class="table__sub">—</span>';
  }

  /** Whom the code is read to — the farmer for her steps, the account holder for sign-in. */
  function person(item) {
    return item.for_farmer
      ? ui.identity(
          item.farmer_name || 'The farmer',
          (item.context ? item.context + ' · ' : '') + 'asked by ' + item.full_name
        )
      : ui.identity(item.full_name, item.who);
  }

  function row(item) {
    return (
      '<tr' +
      (item.state === 'waiting' ? ' class="is-waiting"' : '') +
      '>' +
      '<td>' +
      ui.pill(item.step, item.for_farmer ? 'info' : null) +
      '</td>' +
      '<td>' +
      person(item) +
      '</td>' +
      '<td><span class="table__code">' +
      ui.escapeHtml(item.number_on_file) +
      '</span></td>' +
      '<td>' +
      askedCell(item) +
      '</td>' +
      '<td>' +
      smsCell(item.sms) +
      '</td>' +
      '<td>' +
      stateCell(item) +
      '</td>' +
      '<td>' +
      actionCell(item) +
      '</td>' +
      '</tr>'
    );
  }

  function visible() {
    const term = state.term.toLowerCase();
    const digits = state.term.replace(/\D/g, '');
    if (!term) {
      return state.rows;
    }
    return state.rows.filter(function (item) {
      const words = [item.full_name, item.who, item.farmer_name, item.context, item.step]
        .join(' ')
        .toLowerCase();
      const numbers = [item.number_on_file, item.mobile_no].join(' ');
      return words.indexOf(term) >= 0 || (digits.length >= 3 && numbers.indexOf(digits) >= 0);
    });
  }

  function render() {
    const waiting = state.rows.filter(function (item) {
      return item.state === 'waiting';
    }).length;
    $('#code-count').text(
      waiting
        ? waiting + (waiting === 1 ? ' person waiting for a call' : ' people waiting for a call')
        : 'Nobody waiting'
    );
    ui.rows(
      $('#rows'),
      visible(),
      row,
      state.term
        ? 'Nobody matches “' + state.term + '”.'
        : state.scope === 'open'
          ? 'Nobody is waiting for a code.'
          : 'No codes asked for or given yet.',
      7
    );
  }

  function load() {
    return api
      .superOtps({ state: state.scope })
      .done(function (rows) {
        state.rows = rows || [];
        render();
      })
      .fail(function (problem) {
        MaitAI.shell.alert(problem.detail || 'Could not load the Super OTP list.');
      });
  }

  /* --- the code ------------------------------------------------------------------------- */

  function reveal(issued) {
    window.clearInterval(state.revealTimer);
    $('#reveal').prop('hidden', false);
    if (issued.for_farmer) {
      $('#reveal-who').text(
        (issued.farmer_name || 'The farmer') +
          ' · ' +
          issued.step +
          (issued.context ? ' · ' + issued.context : '')
      );
      $('#reveal-call').text(
        'Call her on ' +
          issued.number_on_file +
          ' — the farmer, not ' +
          issued.full_name +
          ' who asked'
      );
    } else {
      $('#reveal-who').text(issued.full_name + ' · ' + issued.who);
      $('#reveal-call').text('Call ' + issued.number_on_file + ' — the number on file');
    }
    $('#reveal-code').text(issued.code.split('').join(' '));

    const until = new Date(issued.expires_at).getTime();
    const tick = function () {
      const left = Math.max(0, Math.round((until - Date.now()) / 1000));
      $('#reveal-expiry').text(
        left
          ? 'Works for ' + Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0')
          : 'Expired — generate a new one'
      );
      if (!left) {
        window.clearInterval(state.revealTimer);
        hideReveal();
      }
    };
    tick();
    state.revealTimer = window.setInterval(tick, 1000);
    $('#reveal')[0].scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** Gone from the page, not just hidden: the code is not kept anywhere it could be read back. */
  function hideReveal() {
    window.clearInterval(state.revealTimer);
    $('#reveal-code').text('— — — — — —');
    $('#reveal').prop('hidden', true);
  }

  function failed(problem) {
    MaitAI.shell.alert(MaitAI.api.problemToLines(problem).join(' · '));
  }

  function issued(response) {
    reveal(response);
    MaitAI.shell.alert(
      'Code generated for ' +
        (response.for_farmer ? response.farmer_name || 'the farmer' : response.full_name) +
        '. Call ' +
        response.number_on_file +
        ' now.',
      'good'
    );
    load();
  }

  $(function () {
    if (!MaitAI.shell.requireSession()) {
      return;
    }
    MaitAI.shell.mount();
    load();
    window.setInterval(load, REFRESH_MS);

    $('#rows').on('click', '[data-issue]', function () {
      const id = Number($(this).data('issue'));
      const item = state.rows.filter(function (r) {
        return r.id === id;
      })[0];
      if (
        !item ||
        !window.confirm(
          item.for_farmer
            ? 'Generate a ' +
                item.step.toLowerCase() +
                ' code for ' +
                (item.farmer_name || 'the farmer') +
                '?\n\nYou will read it to HER by calling ' +
                item.number_on_file +
                ' — not to ' +
                item.full_name +
                ', who asked.'
            : 'Generate a sign-in code for ' +
                item.full_name +
                '?\n\nYou will read it to them by calling ' +
                item.number_on_file +
                ' — the number on file.'
        )
      ) {
        return;
      }
      $(this).prop('disabled', true);
      api.issueSuperOtp(id).done(issued).fail(failed);
    });

    $('#rows').on('click', '[data-again]', function () {
      const mobile = String($(this).data('again'));
      if (!window.confirm('Replace the code for ' + mobile + ' with a new one?')) {
        return;
      }
      api.issueSuperOtpForNumber(mobile).done(issued).fail(failed);
    });

    $('#rows').on('click', '[data-decline]', function () {
      const id = Number($(this).data('decline'));
      const reason = window.prompt(
        'Why is this declined? The reason is kept on the record.',
        'Could not reach them on the number on file'
      );
      if (reason === null) {
        return;
      }
      api
        .declineSuperOtp(id, reason)
        .done(function () {
          MaitAI.shell.alert('Declined.', 'warn');
          load();
        })
        .fail(failed);
    });

    $('#phone-issue').on('click', function () {
      const mobile = ($('#phone-mobile').val() || '').replace(/\D/g, '');
      if (mobile.length !== 10) {
        MaitAI.shell.alert('The 10-digit number they sign in with.', 'warn');
        $('#phone-mobile').trigger('focus');
        return;
      }
      if (
        !window.confirm(
          'Generate a sign-in code for ' +
            mobile +
            '?\n\nHang up and call that number back before reading it out.'
        )
      ) {
        return;
      }
      api
        .issueSuperOtpForNumber(mobile)
        .done(function (response) {
          $('#phone-mobile').val('');
          issued(response);
        })
        .fail(failed);
    });

    $('#reveal-hide').on('click', hideReveal);

    $('#search').on('input', function () {
      state.term = ($(this).val() || '').trim();
      render();
    });

    $('#show-open, #show-all').on('click', function () {
      state.scope = this.id === 'show-all' ? 'all' : 'open';
      $('#show-open')
        .toggleClass('is-active', state.scope === 'open')
        .attr('aria-pressed', String(state.scope === 'open'));
      $('#show-all')
        .toggleClass('is-active', state.scope === 'all')
        .attr('aria-pressed', String(state.scope === 'all'));
      load();
    });
  });
})(window.MaitAI, jQuery);
