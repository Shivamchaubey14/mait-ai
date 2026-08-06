/**
 * AI event detail (W6).
 *
 * This is the screen a dispute is settled on: a farmer says no insemination happened, or a
 * Mait says the payment was taken. So it shows the evidence — the straw that was deducted,
 * the photo with its stamp, the GPS pin, and the trail of who moved the event when.
 *
 * Nothing here is editable. An admin correcting a field event after the fact would destroy
 * the only thing this record is for.
 */

(function (MaitAI, $) {
  'use strict';

  const ui = MaitAI.ui;

  const STATUS_TONE = {
    completed: 'good',
    payment_pending: 'warn',
    photo_captured: 'info',
    straw_verified: 'info',
    draft: null,
    cancelled: 'bad',
  };

  function eventId() {
    const match = /[?&]id=(\d+)/.exec(window.location.search);
    return match ? match[1] : null;
  }

  function renderSummary(event) {
    $('#event-title').text('Event ' + event.id + ' · ' + event.owner_name);
    $('#event-meta').text(
      [
        event.mpp_code + ' ' + event.mpp_name,
        'Mait ' + event.mait_name + ' (' + event.mait_code + ')',
      ].join(' · ')
    );

    $('#straw-no').text(event.straw_unique_no || 'Not scanned');
    $('#straw-foot').text(
      event.status === 'completed'
        ? event.breed + ' · deducted'
        : event.straw_unique_no
          ? event.breed + ' · held, not yet deducted'
          : 'The event has not reached step 4'
    );

    const payment = event.payment;
    $('#payment-amount').text(payment ? ui.money(payment.amount) : 'None yet');
    $('#payment-foot').text(
      payment ? payment.mode_display + ' · ' + payment.status_display : 'Payment is taken at step 6'
    );

    if (event.gps_lat && event.gps_lng) {
      $('#gps-value').text(
        Number(event.gps_lat).toFixed(4) + ', ' + Number(event.gps_lng).toFixed(4)
      );
      $('#gps-foot').text('Recorded on the device at capture');
    } else {
      $('#gps-value').text('—').addClass('tile__value--warn');
      $('#gps-foot').text('No location recorded yet');
    }

    $('#status-value').text(event.status_display);
    $('#status-foot').text(
      event.completed_at
        ? 'Completed ' + ui.dateTime(event.completed_at)
        : 'Started ' + ui.dateTime(event.created_at)
    );
    if (STATUS_TONE[event.status] === 'bad') {
      $('#status-value').addClass('tile__value--bad');
    } else if (STATUS_TONE[event.status] === 'warn') {
      $('#status-value').addClass('tile__value--warn');
    }

    if (event.ai_photo_url) {
      $('#proof').html(
        '<img class="proof__image" src="' +
          ui.escapeHtml(event.ai_photo_url) +
          '" alt="AI proof photo for event ' +
          event.id +
          '" />'
      );
    } else {
      $('#proof-caption').text('No photo captured yet — the event is at ' + event.status_display);
    }

    if (event.gps_lat && event.gps_lng) {
      $('#map-caption').text(
        'Pin at ' +
          Number(event.gps_lat).toFixed(4) +
          ' N, ' +
          Number(event.gps_lng).toFixed(4) +
          ' E'
      );
    }
  }

  function renderTrail(entries, event) {
    if (!entries.length) {
      $('#trail').html('<li class="trail__step">Nothing recorded yet.</li>');
      return;
    }

    const steps = entries.map(function (entry) {
      return (
        '<li class="trail__step">' +
        '<span class="trail__label">' +
        ui.escapeHtml(entry.note || entry.to_status) +
        '</span>' +
        '<span class="trail__meta">' +
        ui.dateTime(entry.created_at) +
        (entry.actor_name ? ' · ' + ui.escapeHtml(entry.actor_name) : '') +
        '</span>' +
        '</li>'
      );
    });

    // What the event is waiting for, spelled out. A trail that simply stops leaves the
    // operator to work out whether it is finished or stuck.
    if (event.status !== 'completed' && event.status !== 'cancelled') {
      steps.push(
        '<li class="trail__step trail__step--pending">' +
          '<span class="trail__label">Waiting</span>' +
          '<span class="trail__meta">' +
          ui.escapeHtml(nextStep(event.status)) +
          '</span></li>'
      );
    }

    $('#trail').html(steps.join(''));
  }

  function nextStep(status) {
    return (
      {
        draft: 'The Mait has not scanned a straw yet',
        straw_verified: 'Waiting on the proof photo',
        photo_captured: 'Waiting on payment to be initiated',
        payment_pending: 'Waiting on the payment to be verified',
      }[status] || 'No further action recorded'
    );
  }

  $(function () {
    if (!MaitAI.shell.requireSession()) {
      return;
    }
    MaitAI.shell.mount();

    const id = eventId();
    if (!id) {
      MaitAI.shell.alert('No event was named in the address.');
      return;
    }

    MaitAI.api
      .aiEvent(id)
      .done(function (event) {
        renderSummary(event);
        MaitAI.api
          .aiEventTimeline(id)
          .done(function (entries) {
            renderTrail(entries, event);
          })
          .fail(function () {
            $('#trail').html('<li class="trail__step">The trail could not be loaded.</li>');
          });
      })
      .fail(function (problem) {
        MaitAI.shell.alert(
          problem.status === 404 ? 'No such event, or it is outside your scope.' : problem.detail
        );
      });
  });
})(window.MaitAI, jQuery);
