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

  /* Pregnancy outcomes are not symmetrical and neither are their colours: pregnant is the
     result the platform exists to produce, not-pregnant is the one that cost somebody
     money, and unsure is neither — it is a visit that has to happen again. */
  const OUTCOME_TONE = { pregnant: 'good', not_pregnant: 'bad', unsure: 'warn' };

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

    /* The tile leads with the doses rather than the number, because that is what the flask is
       short of: an insemination on a difficult animal takes two straws, and a tile reading one
       number said nothing about the second. The number itself stays underneath, where it is
       still the thing a depot slip is checked against. */
    const doses = event.doses || 1;
    $('#straw-no').text(doses === 1 ? '1 dose' : doses + ' doses');
    $('#straw-foot').text(
      [
        event.semen_breed || event.breed,
        event.straw_unique_no || 'no number read',
        event.status === 'completed'
          ? event.stock_deducted === false
            ? 'closed without a deduction'
            : 'deducted'
          : 'held, not yet deducted',
      ].join(' · ')
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

    renderUsed(event);
    renderChain(event);
    renderProof(event);
    renderMap(event);
  }

  /**
   * The pregnancy checks this insemination booked.
   *
   * Ninety days after the straw somebody has to find out whether it took, and until that
   * happens the record says what was sold rather than what it achieved. Rendered as a chain
   * rather than a single verdict because an unsure result books another check three weeks
   * out: an event whose second check came back pregnant did not fail, and a screen showing
   * only the latest row would make it look like it had.
   *
   * Detail only — the list endpoint does not carry this, so an event page reached before the
   * API was extended simply shows the open-check line rather than breaking.
   */
  function renderChain(event) {
    const checks = event.pregnancy_checks || [];
    const $list = $('#chain').empty();

    if (!checks.length) {
      $('<li>')
        .addClass('chain__none')
        // Said precisely: a completed event with no check is a booking that failed, whereas
        // an unfinished one was never due a check at all, and the two want different people.
        .text(
          event.status === 'completed'
            ? 'No check was booked for this insemination.'
            : 'A check is booked ninety days after the event completes.'
        )
        .appendTo($list);
      return;
    }

    checks.forEach(function (check) {
      const recorded = !!check.outcome;
      const tone = recorded ? OUTCOME_TONE[check.outcome] || 'info' : null;
      const late = !recorded && check.days_until < 0;

      const label = recorded
        ? check.outcome_display
        : late
          ? Math.abs(check.days_until) + ' days overdue'
          : 'Due in ' + check.days_until + ' days';

      const meta = recorded
        ? 'Checked ' + ui.dateTime(check.checked_at)
        : 'Due ' + ui.date(check.due_on);

      $('<li>')
        .addClass('chain__step')
        .toggleClass('chain__step--open', !recorded)
        .toggleClass('chain__step--late', late)
        .append(
          $('<span>')
            .addClass('chain__badge')
            .html(ui.pill(label, tone || 'warn'))
        )
        .append(
          $('<span>')
            .addClass('chain__body')
            .append($('<span>').addClass('chain__meta').text(meta))
            .append(
              check.calving_due_on
                ? // Counted from the insemination and never recomputed — a Mait who checked
                  // late must not move a farmer's calving month with them.
                  $('<span>')
                    .addClass('chain__calving')
                    .text('Calving due ' + ui.date(check.calving_due_on))
                : null
            )
            .append(check.note ? $('<span>').addClass('chain__note').text(check.note) : null)
        )
        .appendTo($list);
    });
  }

  /**
   * Everything that came off the Mait's stock for this event.
   *
   * The semen first, because it is what the event is; then the sheaths and the gloves, which
   * are what a month-end count actually goes missing on. An event captured before the app
   * asked for consumables has none, and the panel says that rather than pretending the visit
   * used nothing.
   */
  function renderUsed(event) {
    const doses = event.doses || 1;
    const breed = event.semen_breed || event.breed || 'Semen';

    const rows = [
      {
        name: breed,
        meta: event.straw_unique_no ? 'Straw ' + event.straw_unique_no : 'By breed, no number read',
        qty: doses === 1 ? '1 dose' : doses + ' doses',
      },
    ];

    (event.consumables || []).forEach(function (line) {
      rows.push({
        name: line.name,
        meta: line.code,
        qty: line.qty + ' ' + line.unit + (line.qty === 1 ? '' : 's'),
      });
    });

    const $list = $('#used').empty();
    rows.forEach(function (row) {
      $('<li>')
        .addClass('used__row')
        .append(
          $('<span>')
            .addClass('used__name')
            .text(row.name)
            .append($('<span>').addClass('used__meta').text(row.meta))
        )
        .append($('<span>').addClass('used__qty').text(row.qty))
        .appendTo($list);
    });

    if (!(event.consumables || []).length) {
      $('<li>')
        .addClass('used__none')
        .text('No consumables recorded against this event.')
        .appendTo($list);
    }
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

    const alt = 'AI proof photo for event ' + event.id;

    $('<img>')
      .addClass('proof__image')
      .attr('alt', alt)
      // Announced as a button, because it is one. Without this a keyboard reaches the photo
      // and finds nothing to press, and a screen reader calls the only interactive thing on
      // the card an image.
      .attr({ role: 'button', tabindex: 0, title: 'Open the full photo' })
      .on('load', function () {
        $('#proof-frame').empty().append(this);
      })
      .on('error', function () {
        $('#proof-empty-text').text('The photo could not be loaded');
        $('#proof-caption').text('AI proof photo · captured ' + ui.dateTime(stamp) + ' · missing');
      })
      .attr('src', src);

    bindLightbox(src, alt, $('#proof-caption').text());
  }

  /**
   * The photo, full size.
   *
   * The card is a preview — bounded, so a portrait handset photo cannot push the audit trail
   * beside it off the screen. But a dispute is settled on what is *in* the photograph, and an
   * ear tag at preview size is not something anybody should be asked to identify. So the card
   * opens.
   *
   * Delegated from the frame rather than bound to the image, because the image is replaced
   * whenever the event reloads and a handler bound to the old element would go with it.
   */
  function bindLightbox(src, alt, caption) {
    const dialog = document.getElementById('lightbox');
    if (!dialog) {
      return;
    }

    // Built here rather than sitting in the markup: an `<img>` with no `src` is invalid, and
    // one with a placeholder is a request for a file that does not exist on every page load.
    $('#lightbox-figure')
      .empty()
      .append($('<img>').addClass('lightbox__image').attr({ src: src, alt: alt }));
    $('#lightbox-caption').text(caption);

    const open = function () {
      // `showModal`, not `show`: it is what puts the page behind it inert and gives Escape
      // its meaning. Guarded because a dialog already open throws on a second call.
      if (!dialog.open) {
        dialog.showModal();
      }
    };

    $('#proof-frame')
      .off('click.lightbox keydown.lightbox')
      .on('click.lightbox', '.proof__image', open)
      .on('keydown.lightbox', '.proof__image', function (e) {
        // Enter and Space, the two keys a button answers to.
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      });

    $('#lightbox-close')
      .off('click.lightbox')
      .on('click.lightbox', function () {
        dialog.close();
      });

    /**
     * Clicking the dark area closes it.
     *
     * A click on a dialog's backdrop is dispatched to the dialog element itself — there is no
     * node to bind to — so this asks where the click landed rather than what it hit. Testing
     * `e.target === dialog` would work for the backdrop but would also fire on the dialog's
     * own padding, and it cannot tell the two apart; the pointer's position can.
     */
    $(dialog)
      .off('click.lightbox')
      .on('click.lightbox', function (e) {
        const r = dialog.getBoundingClientRect();
        const outside =
          e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
        if (outside) {
          dialog.close();
        }
      });
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

    // Stretched over the frame, because a click landing inside a cross-origin iframe belongs
    // to that document and this one never hears about it. It does mean the embedded map no
    // longer pans under the cursor — the card is a way through to the real thing rather than
    // a map to work in, which is what a 200px window on a village is useful for anyway.
    const open = $('<a>')
      .addClass('map__open')
      .attr({
        href: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(point),
        target: '_blank',
        rel: 'noopener noreferrer',
        'aria-label': 'Open ' + point + ' in Google Maps in a new tab',
      })
      .append($('<span>').addClass('map__hint').text('Open in Google Maps ↗'));

    $('#map').addClass('proof__frame--live').empty().append(frame, open);
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
