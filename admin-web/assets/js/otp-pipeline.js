/**
 * OTP pipeline (W23).
 *
 * Every code the platform sends — sign-in, the farmer check, her authorising a payment — read
 * back through the four stations of its pipeline: made, accepted by the gateway, typed in, used.
 * Beside them, every Super OTP ask with a verdict on whether it was needed.
 *
 * **The gateway never says delivered.** It confirms it took a message, and nothing more. So
 * this screen calls a code "arrived" only on proof — somebody typed into it — and a code the
 * gateway accepted that expired untouched, and was not merely replaced by a resend, "likely
 * lost". The server decides all of that once (`apps/dashboard/otp_pipeline.py`); this file only
 * draws it.
 *
 * **A verdict is for information.** "Asked early" or "already through" is a reason for the
 * office to ask a question on the phone, not a reason to refuse — and every verdict says so.
 *
 * Refreshed every thirty seconds while open: codes are sent all day, and somebody watching
 * this screen during a gateway outage should see it happen.
 */

(function (MaitAI, $) {
  'use strict';

  const ui = MaitAI.ui;
  const api = MaitAI.api;
  const LIMIT = 25;
  const REFRESH_MS = 30000;

  const state = { days: 7, purpose: '', search: '', stage: '', verdict: '', offset: 0 };

  function query() {
    const q = { days: state.days, limit: LIMIT, offset: state.offset };
    ['purpose', 'search', 'stage', 'verdict'].forEach(function (key) {
      if (state[key]) {
        q[key] = state[key];
      }
    });
    return q;
  }

  function clock(iso) {
    if (!iso) {
      return '—';
    }
    const d = new Date(iso);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function percent(part, whole) {
    return whole ? Math.round((part / whole) * 100) : 0;
  }

  /* --- the summary ------------------------------------------------------------------------ */

  function drawSummary(body) {
    const s = body.summary;
    const f = s.funnel;
    $('[data-kpi="made"]').text(ui.number(f.made));
    $('[data-kpi="made-foot"]').text(ui.number(f.accepted) + ' accepted by the gateway');
    $('[data-kpi="rate"]').text(s.arrival_rate === null ? '—' : s.arrival_rate + '%');
    $('[data-kpi="rate-foot"]').text(ui.number(f.arrived) + ' typed into — proof they arrived');
    $('[data-kpi="lost"]').text(ui.number(s.likely_lost));
    $('[data-kpi="lost-foot"]').text('Accepted, never typed, expired');
    $('[data-kpi="never"]').text(ui.number(s.never_left));
    $('#window-label').text(
      body.window_days === 1 ? 'Last 24 hours' : 'Last ' + body.window_days + ' days'
    );
  }

  /** The gateway's last twenty sends, in one line. */
  function drawGateway(g) {
    const tone = g.tone || 'info';
    $('#gateway')
      .removeClass('gateway--good gateway--warn gateway--bad gateway--info')
      .addClass('gateway--' + tone);
    $('#gateway-mark').html(
      MaitAI.shell.icon(
        tone === 'bad' ? 'bad' : tone === 'warn' ? 'warn' : tone === 'good' ? 'good' : 'info'
      )
    );
    if (!g.checked) {
      $('#gateway-title').text('No SMS sent in this window');
      $('#gateway-body').text('Nothing to judge the gateway on yet.');
      return;
    }
    $('#gateway-title').text(
      'Gateway ' +
        (g.provider ? '(' + g.provider + ') ' : '') +
        'accepted ' +
        g.accepted +
        ' of the last ' +
        g.checked +
        ' sends'
    );
    $('#gateway-body').text(
      (g.accepted === g.checked
        ? 'Every recent send left the platform. '
        : g.accepted
          ? 'Some sends were refused — check the gateway before the people. '
          : 'Nothing is leaving — the gateway is refusing every send. Super OTP is the way through. ') +
        (g.last_accepted_at ? 'Last accepted ' + ui.dateTime(g.last_accepted_at) + '.' : '')
    );
  }

  function station(label, value, of, tone) {
    return (
      '<div class="funnel__station">' +
      '<p class="funnel__label">' +
      ui.escapeHtml(label) +
      '</p>' +
      '<p class="funnel__value">' +
      ui.number(value) +
      (of !== null ? '<small> · ' + percent(value, of) + '%</small>' : '') +
      '</p>' +
      ui.bar(of === null ? 100 : percent(value, of), tone) +
      '</div>'
    );
  }

  function drawFunnel(body) {
    const f = body.summary.funnel;
    $('#funnel').html(
      station('Code made', f.made, null, 'info') +
        station('Gateway accepted', f.accepted, f.made, 'info') +
        station('Typed in — arrived', f.arrived, f.made, 'good') +
        station('Verified by SMS', f.verified, f.made, 'good')
    );
    ui.rows(
      $('#steps-rows'),
      body.by_purpose,
      function (row) {
        return (
          '<tr><td>' +
          ui.escapeHtml(row.label) +
          '</td><td class="table__num">' +
          ui.number(row.made) +
          '</td><td class="table__num">' +
          ui.number(row.accepted) +
          '</td><td class="table__num">' +
          ui.number(row.arrived) +
          '</td><td class="table__num">' +
          ui.number(row.verified) +
          '</td><td>' +
          (row.arrival_rate === null
            ? '<span class="table__sub">Not known yet</span>'
            : ui.bar(row.arrival_rate, row.arrival_rate >= 80 ? null : 'behind') +
              ' <span class="table__sub">' +
              row.arrival_rate +
              '%</span>') +
          '</td></tr>'
        );
      },
      'No codes sent in this window.',
      6
    );
    // The step picker is drawn from the server's own list, once.
    const $purpose = $('#purpose');
    if ($purpose.children().length === 1) {
      (body.steps || []).forEach(function (step) {
        $purpose.append(
          '<option value="' +
            ui.escapeHtml(step.key) +
            '">' +
            ui.escapeHtml(step.label) +
            '</option>'
        );
      });
      if (MaitAI.controls) {
        MaitAI.controls.sync('#purpose');
      }
    }
  }

  function chips($el, items, chosen, attr, allLabel) {
    $el.html(
      [{ key: '', label: allLabel, tone: null, count: null }]
        .concat(items)
        .map(function (chip) {
          return (
            '<button class="chip' +
            (chip.tone ? ' chip--' + chip.tone : '') +
            (chip.key === chosen ? ' is-active' : '') +
            '" type="button" ' +
            attr +
            '="' +
            ui.escapeHtml(chip.key) +
            '" aria-pressed="' +
            (chip.key === chosen) +
            '">' +
            ui.escapeHtml(chip.label) +
            (chip.count === null ? '' : ' <small>' + ui.number(chip.count) + '</small>') +
            '</button>'
          );
        })
        .join('')
    );
  }

  /* --- the asks ----------------------------------------------------------------------------- */

  function smsBefore(ask) {
    const sms = ask.sms;
    if (!sms) {
      return '<span class="table__sub">No SMS in the hour before</span>';
    }
    return (
      ui.escapeHtml(
        sms.minutes_before < 1 ? 'Under a minute before' : sms.minutes_before + ' min before'
      ) +
      '<span class="table__sub">' +
      (sms.accepted ? 'Gateway accepted' : 'Gateway did not accept') +
      ' · ' +
      (sms.by_office
        ? 'closed by the office code'
        : sms.verified
          ? 'used'
          : sms.attempt_count
            ? sms.attempt_count + ' typed'
            : 'nothing typed') +
      '</span>'
    );
  }

  function askRow(ask) {
    const who = ask.for_farmer
      ? ui.identity(
          ask.farmer_name || 'The farmer',
          (ask.context ? ask.context + ' · ' : '') + 'asked by ' + ask.full_name
        )
      : ui.identity(ask.full_name, '');
    const asked = ask.phoned
      ? 'Phoned the office'
      : ui.escapeHtml(ui.dateTime(ask.asked_at)) +
        (ask.request_count > 1 ? ' · ' + ask.request_count + '×' : '') +
        (ask.reason ? '<span class="table__sub">“' + ui.escapeHtml(ask.reason) + '”</span>' : '');
    return (
      '<tr' +
      (ask.state === 'waiting' ? ' class="is-waiting"' : '') +
      '><td>' +
      ui.pill(ask.step, ask.for_farmer ? 'info' : null) +
      '</td><td>' +
      who +
      '</td><td><span class="table__code">' +
      ui.escapeHtml(ask.mobile_no) +
      '</span></td><td>' +
      asked +
      '</td><td>' +
      smsBefore(ask) +
      '</td><td>' +
      ui.pill(ask.verdict.label, ask.verdict.tone) +
      '<span class="table__sub">' +
      ui.escapeHtml(ask.verdict.detail) +
      '</span>' +
      (ask.through_by_sms_after
        ? '<span class="table__sub verdict__after">Got through by SMS after asking</span>'
        : '') +
      '</td><td>' +
      ui.pill(ask.status_display, ask.state === 'waiting' ? 'warn' : null) +
      '</td></tr>'
    );
  }

  /* --- the codes ---------------------------------------------------------------------------- */

  /** Four dots and the lines between them: done, failed, waiting or skipped. */
  function pipeline(steps) {
    return (
      '<span class="pipe" role="img" aria-label="' +
      ui.escapeHtml(
        steps
          .map(function (step) {
            return step.label + ': ' + step.state;
          })
          .join(', ')
      ) +
      '">' +
      steps
        .map(function (step) {
          return (
            '<span class="pipe__dot pipe__dot--' +
            step.state +
            '" title="' +
            ui.escapeHtml(step.label + (step.at ? ' · ' + clock(step.at) : '')) +
            '"></span>'
          );
        })
        .join('<span class="pipe__line"></span>') +
      '</span>'
    );
  }

  function codeRow(code) {
    return (
      '<tr><td>' +
      ui.escapeHtml(ui.dateTime(code.sent_at)) +
      '</td><td>' +
      ui.escapeHtml(code.step) +
      '</td><td>' +
      ui.identity(code.who.name, code.who.detail) +
      '</td><td><span class="table__code">' +
      ui.escapeHtml(code.mobile_no) +
      '</span></td><td>' +
      pipeline(code.steps) +
      '</td><td>' +
      ui.pill(code.stage_display, code.tone) +
      '<span class="table__sub">' +
      ui.escapeHtml(code.guidance) +
      (code.attempt_count
        ? ' ' + code.attempt_count + ' of ' + code.max_attempts + ' tries.'
        : '') +
      '</span></td></tr>'
    );
  }

  /* --- loading ------------------------------------------------------------------------------ */

  function load() {
    return api
      .otpPipeline(query())
      .done(function (body) {
        drawSummary(body);
        drawGateway(body.gateway);
        drawFunnel(body);
        chips($('#verdicts'), body.verdicts, state.verdict, 'data-verdict', 'Every ask');
        chips($('#stages'), body.stages, state.stage, 'data-stage', 'Every code');
        ui.rows(
          $('#asks-rows'),
          body.asks,
          askRow,
          state.verdict
            ? 'No ask has that verdict.'
            : 'Nobody asked the office for a code in this window.',
          7
        );
        $('#codes-count').text(ui.number(body.count) + (body.count === 1 ? ' code' : ' codes'));
        ui.rows(
          $('#codes-rows'),
          body.results,
          codeRow,
          state.stage || state.search || state.purpose
            ? 'No code matches that.'
            : 'No codes sent in this window.',
          6
        );
        ui.pager(
          $('#pager'),
          { count: body.count, limit: LIMIT, offset: state.offset },
          function (offset) {
            state.offset = offset;
            load();
          }
        );
      })
      .fail(function (problem) {
        MaitAI.shell.alert(problem.detail || 'Could not load the OTP pipeline.');
      });
  }

  function refilter() {
    state.offset = 0;
    load();
  }

  $(function () {
    if (!MaitAI.shell.requireSession()) {
      return;
    }
    MaitAI.shell.mount();
    load();
    window.setInterval(load, REFRESH_MS);

    $('#refresh').on('click', load);

    let typing = null;
    $('#search').on('input', function () {
      const value = ($(this).val() || '').trim();
      window.clearTimeout(typing);
      typing = window.setTimeout(function () {
        state.search = value;
        refilter();
      }, 300);
    });

    $('#purpose').on('change', function () {
      state.purpose = $(this).val() || '';
      refilter();
    });

    $('#days').on('change', function () {
      state.days = Number($(this).val()) || 7;
      refilter();
    });

    $('#stages').on('click', '.chip[data-stage]', function () {
      state.stage = $(this).attr('data-stage') || '';
      refilter();
    });

    $('#verdicts').on('click', '.chip[data-verdict]', function () {
      state.verdict = $(this).attr('data-verdict') || '';
      load();
    });
  });
})(window.MaitAI, jQuery);
