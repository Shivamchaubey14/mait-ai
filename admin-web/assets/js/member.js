/**
 * Member detail (W10).
 *
 * The record behind a row on the Members list, opened for one of two reasons: somebody is
 * reading a member's details back down the phone, or somebody is checking the animals a Mait
 * registered against her before the first insemination was recorded.
 *
 * The animals are the reason this screen exists in the portal. Step 3 of the capture flow
 * registers them, and until now there was nowhere in the back office to see what had been put
 * on a member's record — only the non-member had a detail page. This is the member's, built from
 * the same pieces so the two read alike: the four-tile summary, the animals table, and the facts
 * column an operator reads from.
 *
 * Read-only. Changing a member's mobile number stays on the list, where the dialog, the reason
 * and the audit trail live; this screen only shows what is on file.
 */

(function (MaitAI, $) {
  'use strict';

  const ui = MaitAI.ui;
  const shell = MaitAI.shell;

  const state = { record: null };

  /** `98123 45678` — the way a number is read out over the phone. */
  function spaced(digits) {
    return digits && digits.length === 10 ? digits.slice(0, 5) + ' ' + digits.slice(5) : digits;
  }

  function fact(label, value, absent) {
    return (
      '<div class="facts__row">' +
      '<dt class="facts__label">' +
      ui.escapeHtml(label) +
      '</dt>' +
      '<dd class="facts__value' +
      (absent ? ' facts__value--absent' : '') +
      '">' +
      value +
      '</dd>' +
      '</div>'
    );
  }

  /** A recorded value, or a muted em dash saying plainly that nobody recorded one. */
  function orAbsent(label, value, absentText) {
    if (value || value === 0) {
      return fact(label, ui.escapeHtml(String(value)));
    }
    return fact(label, ui.escapeHtml(absentText || 'Not recorded'), true);
  }

  /**
   * One registered animal, told apart from the one beside her by when she was last served.
   *
   * The same row the non-member page draws, and for the same reason: an untagged cow is
   * identified by her breed, her tag if she has one, and the day of her last insemination, and
   * by nothing else the platform holds.
   */
  function animalRow(animal) {
    return (
      '<tr>' +
      '<td>' +
      ui.identity(animal.animal_type_display || animal.animal_type, 'Animal #' + animal.id) +
      '</td>' +
      '<td>' +
      (animal.breed
        ? ui.escapeHtml(animal.breed)
        : '<span class="table__sub">Not recorded</span>') +
      '</td>' +
      '<td>' +
      (animal.ear_tag_no
        ? '<span class="table__code">' + ui.escapeHtml(animal.ear_tag_no) + '</span>'
        : '<span class="table__sub">No tag</span>') +
      '</td>' +
      '<td class="table__num">' +
      ui.number(animal.ai_event_count || 0) +
      '</td>' +
      '<td>' +
      (animal.last_ai_at
        ? ui.escapeHtml(ui.date(animal.last_ai_at))
        : '<span class="table__sub">Never served</span>') +
      '</td>' +
      '</tr>'
    );
  }

  function renderTiles(record) {
    const animals = record.animals || [];
    const inseminations = animals.reduce(function (sum, animal) {
      return sum + (animal.ai_event_count || 0);
    }, 0);

    // Membership — the first thing a caller is told. 'Yes' is the SAP master's active flag.
    const active = record.activation_status === 'Yes';
    $('#status-tile').addClass(active ? 'tile--good' : 'tile--warn');
    $('#status-icon').html(shell.icon(active ? 'good' : 'warn'));
    $('#status-value').html(ui.pill(active ? 'Active' : 'Inactive', active ? 'good' : 'warn'));
    $('#status-foot').text(
      active
        ? record.activation_date
          ? 'Active since ' + ui.date(record.activation_date)
          : 'Active member'
        : 'Not activated'
    );

    // Whether a payment can be authorised for her at all (SRS §6.5): it needs a usable number
    // for the OTP. The one consequence worth a tile — a Mait who starts a flow for a member
    // with no number is stranded with the straw already used.
    const otp = !!record.can_receive_otp;
    $('#otp-tile').addClass(otp ? 'tile--good' : 'tile--bad');
    $('#otp-icon').html(shell.icon(otp ? 'good' : 'bad'));
    $('#otp-value').html(ui.pill(otp ? 'Can authorise' : 'Blocked', otp ? 'good' : 'bad'));
    $('#otp-foot').text(record.mobile_no ? spaced(record.mobile_no) : 'No usable number on file');

    $('#animals-value').text(ui.number(animals.length));
    $('#animals-foot').text(animals.length ? 'On her record' : 'None registered yet');

    $('#events-value').text(ui.number(inseminations));
  }

  function renderFacts(record) {
    const household = record.father_husband_name
      ? 'Father / husband: ' + record.father_husband_name
      : '';

    const genderAge = [record.gender, record.age ? record.age + ' yrs' : '']
      .filter(Boolean)
      .join(' · ');

    const bank = record.bank_name
      ? ui.escapeHtml(record.bank_name) +
        (record.ifsc_code
          ? '<span class="table__sub">' + ui.escapeHtml(record.ifsc_code) + '</span>'
          : '')
      : '';

    $('#facts').html(
      [
        orAbsent('Household', household, 'Not recorded'),
        orAbsent('Gender · age', genderAge),
        orAbsent('Category', record.category),
        orAbsent('Education', record.education),
        // The one fact with a consequence attached: no number means no payment code.
        record.mobile_no
          ? fact('Mobile', ui.escapeHtml(spaced(record.mobile_no)))
          : fact('Mobile', ui.pill('No number', 'bad')),
        fact(
          'Aadhaar',
          '<span class="card-note__value">' + ui.escapeHtml(record.aadhar_no || '—') + '</span>'
        ),
        // Reported in the SAP master, not measured — the household's own count of animals.
        Number(record.cattle_holding) > 0
          ? fact('Cattle holding', ui.escapeHtml(ui.number(Number(record.cattle_holding))))
          : fact('Cattle holding', 'Not recorded', true),
        bank ? fact('Bank', bank) : fact('Bank', 'Not recorded', true),
        // What SAP knows her by, and what stays the same when she moves MPP and gets a new
        // member code. The history below is joined on it.
        record.sap_vendor_code
          ? fact(
              'SAP vendor',
              '<span class="table__code">' + ui.escapeHtml(record.sap_vendor_code) + '</span>'
            )
          : fact('SAP vendor', 'Not recorded', true),
        orAbsent('Folio', record.folio_no),
        fact(
          'MPP',
          ui.escapeHtml(record.mpp_name || '—') +
            (record.mpp_code
              ? '<span class="table__sub">' + ui.escapeHtml(record.mpp_code) + '</span>'
              : '')
        ),
        record.activation_date
          ? fact('Activated', ui.escapeHtml(ui.date(record.activation_date)))
          : fact('Activated', 'Not recorded', true),
      ].join('')
    );
  }

  /** One member code she has held — the one this page is about marked as such. */
  function codeRow(row) {
    return (
      '<tr>' +
      '<td>' +
      (row.current
        ? '<span class="table__code">' +
          ui.escapeHtml(row.member_code) +
          '</span> ' +
          ui.pill('This page', 'info')
        : '<a class="table__code" href="member.html?code=' +
          encodeURIComponent(row.member_code) +
          '">' +
          ui.escapeHtml(row.member_code) +
          '</a>') +
      '</td>' +
      '<td>' +
      ui.escapeHtml(row.mpp_name || '—') +
      '<span class="table__sub">' +
      ui.escapeHtml(row.mpp_code || '') +
      '</span></td>' +
      '<td>' +
      ui.escapeHtml(row.activation_status || '—') +
      '</td>' +
      '<td>' +
      ui.escapeHtml(row.activation_date ? ui.date(row.activation_date) : '—') +
      '</td>' +
      '<td class="table__num">' +
      ui.number(row.ai_count || 0) +
      '</td>' +
      '</tr>'
    );
  }

  /** One insemination, saying which of her codes it was recorded against. */
  function historyRow(current) {
    return function (event) {
      const other = event.member_code !== current;
      return (
        '<tr>' +
        '<td><a class="table__code" href="ai-event.html?id=' +
        event.id +
        '">#' +
        event.id +
        '</a></td>' +
        '<td>' +
        ui.escapeHtml(ui.date(event.at)) +
        '</td>' +
        '<td><span class="table__code">' +
        ui.escapeHtml(event.member_code) +
        '</span>' +
        // The rows from her other code are the ones this table exists to show.
        (other ? ' ' + ui.pill('Earlier code', 'warn') : '') +
        '</td>' +
        '<td>' +
        ui.escapeHtml(event.mpp_name || '—') +
        '<span class="table__sub">' +
        ui.escapeHtml(event.mpp_code || '') +
        '</span></td>' +
        '<td>' +
        ui.escapeHtml([event.animal_type, event.breed].filter(Boolean).join(' · ') || '—') +
        (event.ear_tag_no
          ? '<span class="table__sub">Tag ' + ui.escapeHtml(event.ear_tag_no) + '</span>'
          : '') +
        '</td>' +
        '<td>' +
        ui.escapeHtml(event.mait_name || '—') +
        '</td>' +
        '<td>' +
        ui.escapeHtml(event.status_display || event.status) +
        '</td>' +
        '</tr>'
      );
    };
  }

  function loadHistory(code) {
    MaitAI.api
      .memberHistory(code)
      .done(function (history) {
        const codes = history.codes || [];
        $('#history-vendor').text(
          history.sap_vendor_code
            ? 'SAP vendor ' +
                history.sap_vendor_code +
                ' · ' +
                codes.length +
                (codes.length === 1 ? ' code' : ' codes')
            : 'No SAP vendor on file'
        );
        ui.rows($('#code-rows'), codes, codeRow, 'No codes on file.', 5);
        ui.rows(
          $('#history-rows'),
          history.events || [],
          historyRow(code),
          'No inseminations under any of her codes yet.',
          7
        );
      })
      .fail(function () {
        ui.rows($('#code-rows'), [], codeRow, 'Could not load her history.', 5);
        ui.rows($('#history-rows'), [], historyRow(code), 'Could not load her history.', 7);
      });
  }

  function load(code) {
    MaitAI.api
      .member(code)
      .done(function (record) {
        state.record = record;
        document.title = (record.member_name || 'Member') + ' · Mait AI Admin';
        $('#member-name').text(record.member_name || 'Member');
        $('#member-meta').text(
          record.member_code +
            (record.mpp_name ? ' · ' + record.mpp_name : '') +
            (record.mpp_code ? ' (' + record.mpp_code + ')' : '')
        );

        renderTiles(record);
        renderFacts(record);

        const animals = record.animals || [];
        $('#animals-count').text(
          animals.length ? animals.length + (animals.length === 1 ? ' animal' : ' animals') : ''
        );
        ui.rows($('#animal-rows'), animals, animalRow, 'No animals registered to her yet.', 5);
      })
      .fail(function (problem) {
        shell.alert(
          problem.status === 404
            ? 'That member does not exist, or is outside your zones.'
            : problem.detail
        );
        ui.rows($('#animal-rows'), [], animalRow, 'Could not load her animals.', 5);
      });
  }

  $(function () {
    if (!shell.requireSession()) {
      return;
    }
    shell.mount();

    const code = shell.param('code');
    if (!code) {
      // Reached without a code — a bookmark to the bare page, or a link built wrong. Say so
      // rather than showing a screenful of em dashes that looks like a member with no details.
      shell.alert('No member was named in the link. Open one from the list.');
      return;
    }
    load(code);
    loadHistory(code);
  });
})(window.MaitAI, jQuery);
