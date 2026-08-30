/**
 * Non-member detail (W10c).
 *
 * The record behind a row on the Non-members list, opened for one of two reasons: somebody is
 * checking that a farmer a Mait registered is real, or somebody is settling a question about
 * money she paid. Both are answered by the same two things — the card against the number, and
 * the inseminations against her animals — so both are on one screen rather than behind tabs.
 *
 * The card images are the only PII this portal renders as pictures rather than as masked text,
 * and the API logs the read against the operator's account. The screen says so, on the panel,
 * where the person doing it will see it.
 */

(function (MaitAI, $) {
  'use strict';

  const ui = MaitAI.ui;
  const shell = MaitAI.shell;

  /** Every face of the card, or the ones that are missing, as one sentence. */
  function cardState(record) {
    const front = !!record.aadhar_front_captured;
    const back = !!record.aadhar_back_captured;

    if (front && back) {
      return { label: 'On file', tone: 'good', glyph: 'good', foot: 'Both faces photographed' };
    }
    if (front || back) {
      return {
        label: front ? 'Front only' : 'Back only',
        tone: 'warn',
        glyph: 'warn',
        foot: 'Ask her Mait for the ' + (front ? 'back' : 'front'),
      };
    }
    return {
      label: 'Missing',
      tone: 'bad',
      glyph: 'bad',
      foot: 'Nothing to check the number against',
    };
  }

  /**
   * Put one image in its well, or leave the empty frame the HTML already carries.
   *
   * `mediaUrl` because the API returns these root-relative, which is correct behind nginx and
   * a 404 on the development path where the portal is served on its own port.
   */
  function renderFace(which, url) {
    const $frame = $('#' + which + '-frame');
    if (!url) {
      $frame.addClass('card-shot__frame--empty');
      return;
    }
    const href = MaitAI.api.mediaUrl(url);
    const label = which === 'front' ? 'Front of the Aadhaar card' : 'Back of the Aadhaar card';

    $frame
      .removeClass('card-shot__frame--empty')
      .empty()
      .append(
        // A link, not a lightbox. The panel's whole job is checking twelve digits against a
        // photograph, and the well is a third of a screen wide — too small to read a number
        // off. The browser's own image viewer opens it at full size, handles zoom, and costs
        // no script on a page that renders PII (README forbids third-party script here).
        $('<a>')
          .addClass('card-shot__open')
          .attr({
            href: href,
            target: '_blank',
            rel: 'noopener noreferrer',
            title: 'Open ' + label.toLowerCase() + ' at full size',
          })
          .append(
            $('<img>').addClass('card-shot__image').attr({
              src: href,
              // Named rather than described: an operator using a screen reader is checking
              // that a photograph exists and is theirs to look at, not being told what an
              // Aadhaar looks like. The number itself is never in alt text.
              alt: label,
              // These are handset photographs at full resolution — several megabytes each.
              // Decoding them off the main thread keeps the rest of the record usable while
              // they arrive.
              decoding: 'async',
            })
          )
      );
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
    if (value) {
      return fact(label, ui.escapeHtml(value));
    }
    return fact(label, ui.escapeHtml(absentText || 'Not recorded'), true);
  }

  function renderFacts(record) {
    const household = record.father_husband_name
      ? (record.relation_display || 'Father / husband') + ': ' + record.father_husband_name
      : '';

    $('#facts').html(
      [
        orAbsent('Household', household, 'Not recorded'),
        // The one fact with a consequence attached: no number means no payment code, which
        // means her Mait cannot close an event for her at all.
        record.mobile_no
          ? fact('Mobile', ui.escapeHtml(record.mobile_no))
          : fact('Mobile', ui.pill('No number', 'bad')),
        orAbsent('Address', record.address),
        fact(
          'Aadhaar',
          '<span class="card-note__value">' + ui.escapeHtml(record.masked_aadhar || '—') + '</span>'
        ),
        fact(
          'MPP',
          ui.escapeHtml(record.mpp_name || '—') +
            (record.mpp_code
              ? '<span class="table__sub">' + ui.escapeHtml(record.mpp_code) + '</span>'
              : '')
        ),
        fact(
          'Registered by',
          ui.escapeHtml(record.registered_by || '—') +
            (record.registered_by_code
              ? '<span class="table__sub">' + ui.escapeHtml(record.registered_by_code) + '</span>'
              : '')
        ),
        // Reported at registration, not measured — worded so nobody reads it as a meter
        // reading. It sits with her details rather than in the tile row above because it is a
        // detail of the household, not one of the four things a record is judged on.
        Number(record.daily_yield_litres) > 0
          ? fact(
              'Milk a day',
              ui.escapeHtml(ui.number(Number(record.daily_yield_litres)) + ' litres') +
                '<span class="table__sub">As reported at registration</span>'
            )
          : fact('Milk a day', ui.escapeHtml('Not recorded'), true),
        fact('Registered', ui.escapeHtml(ui.dateTime(record.created_at))),
        record.consent_captured_at
          ? fact('Consent given', ui.escapeHtml(ui.dateTime(record.consent_captured_at)))
          : fact('Consent given', ui.pill('Not on record', 'warn')),
      ].join('')
    );
  }

  /**
   * One payment, and whatever stands behind it.
   *
   * Cash is settled by the farmer's own authorisation code and leaves nothing to look at, so
   * those rows say so rather than showing two empty cells — an em dash under "Reference" reads
   * as a missing record, and for cash there was never anything to record.
   *
   * Online is the row somebody actually checks. The UTR is what reconciles against a bank
   * statement and the screenshot is what says the reference was not simply typed in, so the
   * two are shown together and neither is much use alone.
   */
  function paymentRow(payment) {
    const online = payment.mode === 'ONLINE';
    const shot = payment.payment_screenshot_url;

    return (
      '<tr>' +
      '<td>' +
      ui.escapeHtml(ui.dateTime(payment.created_at)) +
      '<span class="table__sub">AI event ' +
      ui.escapeHtml(String(payment.ai_event)) +
      '</span>' +
      '</td>' +
      '<td class="table__num">' +
      ui.escapeHtml(ui.money(payment.amount)) +
      '</td>' +
      '<td>' +
      ui.escapeHtml(payment.mode_display || payment.mode) +
      '</td>' +
      '<td>' +
      (online
        ? payment.utr_number
          ? '<span class="table__code">' + ui.escapeHtml(payment.utr_number) + '</span>'
          : ui.pill('Not on file', 'bad')
        : '<span class="table__sub">Cash — code only</span>') +
      '</td>' +
      '<td>' +
      (online ? proofLink(shot) : '<span class="table__sub">Nothing to show</span>') +
      '</td>' +
      '<td>' +
      (payment.is_verified
        ? ui.pill(payment.status_display || 'Verified', 'good')
        : ui.pill(payment.status_display || 'Pending', 'warn')) +
      '</td>' +
      '</tr>'
    );
  }

  /**
   * The screenshot, as a link rather than a thumbnail.
   *
   * Same reasoning as the Aadhaar wells above: a payment screen is read for a reference and an
   * amount, and neither is legible at the size a table cell allows. The browser's own viewer
   * opens it full size and costs no script on a page that renders PII.
   */
  function proofLink(url) {
    if (!url) {
      return ui.pill('Not on file', 'bad');
    }
    return (
      '<a class="proof-link" target="_blank" rel="noopener noreferrer" href="' +
      ui.escapeHtml(MaitAI.api.mediaUrl(url)) +
      '" title="Open the payment screenshot at full size">' +
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4" /></svg>' +
      'Screenshot</a>'
    );
  }

  /**
   * The panel, or nothing at all.
   *
   * A farmer with no payment yet is an ordinary state — she may have been registered and not
   * yet served — and an empty table under a heading reads as a record with something missing.
   */
  function renderPayments(record) {
    const payments = record.payments || [];
    if (!payments.length) {
      $('#payments-panel').prop('hidden', true);
      return;
    }

    const online = payments.filter(function (row) {
      return row.mode === 'ONLINE';
    }).length;

    $('#payments-panel').prop('hidden', false);
    $('#payment-rows').html(payments.map(paymentRow).join(''));
    $('#payments-count').text(payments.length + (online ? ' · ' + online + ' paid online' : ''));
  }

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
      ui.number(animal.ai_event_count) +
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
    const card = cardState(record);
    $('#card-tile').addClass('tile--' + card.tone);
    // The evidence panel wears the state of the evidence — green when both faces are on file,
    // red when there are none. It is the one panel on the screen whose colour is an answer
    // rather than a label, so it is set here and not in the markup.
    $('#card-panel').addClass('panel--' + card.tone);
    $('#card-icon').html(shell.icon(card.glyph));
    $('#card-panel-icon').html(shell.icon(card.glyph));
    $('#card-value').html(ui.pill(card.label, card.tone));
    $('#card-foot').text(card.foot);
    // Nothing to open when neither face was taken — an instruction to click something that is
    // not there reads as a broken screen rather than as a missing photograph.
    $('#open-hint').prop('hidden', !record.aadhar_front_captured && !record.aadhar_back_captured);
    $('#card-count').text(
      (record.aadhar_front_captured ? 1 : 0) + (record.aadhar_back_captured ? 1 : 0) + ' of 2 faces'
    );

    const consented = !!record.consent_captured_at;
    $('#consent-tile').addClass(consented ? 'tile--good' : 'tile--warn');
    $('#consent-icon').html(shell.icon(consented ? 'good' : 'warn'));
    $('#consent-value').html(
      ui.pill(consented ? 'Given' : 'Not on record', consented ? 'good' : 'warn')
    );
    $('#consent-foot').text(
      consented ? ui.dateTime(record.consent_captured_at) : 'Registered before it was captured'
    );

    $('#animals-value').text(ui.number(record.animal_count));
    $('#events-value').text(ui.number(record.ai_event_count));
    $('#animals-foot').text(record.animal_count ? 'On her record' : 'None registered yet');

    renderHerd(record);
  }

  /**
   * What she reported keeping, when she was asked.
   *
   * Zero is two different answers here and they must not be shown the same way: a farmer who
   * told a Mait she keeps none, and a farmer registered before the question existed. The
   * second is by far the commoner, and printing a bold 0 for it states as fact something
   * nobody ever asked.
   *
   * The tile is toned only when there is something to compare — an unasked record is not a
   * finding, and colouring it would put a judgement on a blank.
   */
  function renderHerd(record) {
    const cows = record.cattle_cows || 0;
    const buffaloes = record.cattle_buffaloes || 0;
    const total = record.cattle_total || 0;
    const litres = Number(record.daily_yield_litres || 0);

    if (!total && !litres) {
      $('#herd-value').html(ui.pill('Not asked', 'warn'));
      $('#herd-foot').text('Registered before the question');
      return;
    }

    $('#herd-tile').addClass('tile--info');
    $('#herd-value').text(ui.number(total));
    $('#herd-foot').text(ui.number(cows) + ' cow · ' + ui.number(buffaloes) + ' buffalo');
  }

  function load(id) {
    MaitAI.api
      .nonMember(id)
      .done(function (record) {
        document.title = record.name + ' · Mait AI Admin';
        $('#farmer-name').text(record.name || 'Non-member');
        $('#farmer-meta').text(
          'Registered ' +
            ui.dateTime(record.created_at) +
            (record.registered_by ? ' by ' + record.registered_by : '') +
            (record.mpp_name ? ' · ' + record.mpp_name : '')
        );

        renderTiles(record);
        renderPayments(record);
        renderFacts(record);
        $('#masked-aadhaar').text(record.masked_aadhar || '—');
        renderFace('front', record.aadhar_front_url);
        renderFace('back', record.aadhar_back_url);

        ui.rows(
          $('#animal-rows'),
          record.animals,
          animalRow,
          'No animals registered to her yet.',
          5
        );
      })
      .fail(function (problem) {
        shell.alert(
          problem.status === 404
            ? 'That non-member does not exist, or has been removed.'
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

    const id = shell.param('id');
    if (!id) {
      // Reached without an id — a bookmark to the bare page, or a link built wrong. Say so
      // rather than showing a screenful of em dashes that looks like a farmer with no details.
      shell.alert('No non-member was named in the link. Open one from the list.');
      return;
    }
    load(id);
  });
})(window.MaitAI, jQuery);
