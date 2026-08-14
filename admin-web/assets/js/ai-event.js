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

  /* Which glyph a tone gets on the Status tile. Waiting is a clock, not a warning triangle —
     an event at step 5 has not gone wrong, it has not finished. */
  const TONE_ICON = { good: 'good', warn: 'clock', bad: 'bad', info: 'info' };

  /** Put a tile's tone on, having cleared whichever one was there before. */
  function tone($tile, name) {
    $tile.removeClass('tile--good tile--warn tile--bad tile--info');
    if (name) {
      $tile.addClass('tile--' + name);
    }
  }

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

    // Money is green once it is verified and yellow while it is not, the same way the
    // dashboard's Pending payments card is yellow. A failed payment is the one thing on this
    // screen that needs someone to act, so it goes red.
    const payment = event.payment;
    $('#payment-amount').text(payment ? ui.money(payment.amount) : 'None yet');
    $('#payment-foot').text(
      payment ? payment.mode_display + ' · ' + payment.status_display : 'Payment is taken at step 6'
    );
    tone(
      $('#payment-tile'),
      !payment ? null : payment.status === 'failed' ? 'bad' : payment.is_verified ? 'good' : 'warn'
    );

    if (event.gps_lat && event.gps_lng) {
      $('#gps-value').text(
        Number(event.gps_lat).toFixed(4) + ', ' + Number(event.gps_lng).toFixed(4)
      );
      $('#gps-foot').text('Recorded on the device at capture');
    } else {
      // The tile's own tint carries this now, so the value keeps the tile's ink.
      tone($('#gps-tile'), 'warn');
      $('#gps-value').text('—');
      $('#gps-foot').text('No location recorded yet');
    }

    const statusTone = STATUS_TONE[event.status];
    $('#status-value').html(ui.pill(event.status_display, statusTone));
    $('#status-foot').text(
      event.completed_at
        ? 'Completed ' + ui.dateTime(event.completed_at)
        : 'Started ' + ui.dateTime(event.created_at)
    );
    tone($('#status-tile'), statusTone);
    $('#status-icon').html(MaitAI.shell.icon(TONE_ICON[statusTone] || 'info'));

    renderProof(event);
    renderMap(event);
  }

  /**
   * The proof photo, or an honest statement that there is not one.
   *
   * `ai_photo_url` is root-relative, and on the development path the portal is not served from
   * the API's origin — so this goes through `api.mediaUrl()` rather than into `src` as it
   * comes. The `error` handler covers the rest: a photo whose file has gone from the bucket
   * should say so in words, not leave the browser's broken-image glyph on a dark box.
   */
  function renderProof(event) {
    const src = MaitAI.api.mediaUrl(event.ai_photo_url);
    if (!src) {
      $('#proof-empty-text').text('No photo yet — the event is at ' + event.status_display);
      $('#proof-caption').text('AI proof photo — nothing captured yet');
      return;
    }

    const stamp = event.performed_at || event.created_at;
    $('#proof-caption').text('AI proof photo · captured ' + ui.dateTime(stamp));

    $('<img>')
      .addClass('proof__image')
      .attr('alt', 'AI proof photo for event ' + event.id)
      .on('load', function () {
        $('#proof-frame').empty().append(this);
      })
      .on('error', function () {
        $('#proof-empty-text').text('The photo could not be loaded');
        $('#proof-caption').text('AI proof photo · captured ' + ui.dateTime(stamp) + ' · missing');
      })
      .attr('src', src);
  }

  /**
   * The map, pinned to where the event was captured.
   *
   * `maps.google.com/maps?q=…&output=embed` rather than the Embed API: it takes no key, so
   * the pin is on the card on every deployment from the moment this ships, including this
   * one. It is Google's long-standing keyless embed and not part of the documented Embed API
   * — if it is ever withdrawn, the replacement is the same URL with `/maps/embed/v1/place`
   * and a key, and only the string below changes.
   *
   * Framed, not scripted. This page renders member PII and README.md forbids third-party
   * script on it; a cross-origin frame cannot read this document. The sandbox withholds
   * `allow-top-navigation`, so the framed page cannot move the operator off the portal.
   *
   * `q=lat,lng` is what drops the marker on the point. Without it the same map draws centred
   * on the village with nothing marked, which answers a different question.
   */
  function renderMap(event) {
    if (!event.gps_lat || !event.gps_lng) {
      $('#map-foot').text('No location was recorded for this event');
      return;
    }

    const lat = Number(event.gps_lat);
    const lng = Number(event.gps_lng);
    const point = lat + ',' + lng;

    // The figures stay under the map: a pin shows roughly where, and a dispute is settled on
    // exactly where.
    $('#map-foot').text(
      lat.toFixed(4) + '° N, ' + lng.toFixed(4) + '° E · recorded by the handset at capture'
    );

    const frame = $('<iframe>')
      .addClass('map__embed')
      .attr({
        title: 'Map of where event ' + event.id + ' was captured',
        loading: 'lazy',
        sandbox: 'allow-scripts allow-same-origin allow-popups allow-forms',
        src: 'https://maps.google.com/maps?q=' + encodeURIComponent(point) + '&z=17&output=embed',
      });

    $('#map').addClass('proof__frame--live').empty().append(frame);
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
