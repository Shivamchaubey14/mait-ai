/**
 * Pregnancy diagnosis oversight (W18).
 *
 * The app's pregnancy screens answer a Mait's question — which yard do I walk to next. This
 * one answers an admin's, and it is a different question: *is anybody's round being dropped*,
 * and *is any of this working*.
 *
 * So the table is by Mait rather than by animal, most overdue first, and the headline is
 * conception rate — the number this platform is ultimately judged on, and the only one here
 * that says whether the work is achieving anything rather than merely happening.
 *
 * Read-only. Recording a result is the Mait's job, done with a hand on the animal; a portal
 * button that wrote an outcome would be a result nobody took.
 */

(function (MaitAI, $) {
  'use strict';

  const ui = MaitAI.ui;

  const state = { rows: [], loaded: false, overdueFirst: true, maitId: null, window: 'due' };

  /* --- the rate ------------------------------------------------------------------------
   * Null and zero are different answers and must not render the same way: 0% is a Mait whose
   * inseminations are failing, and no rate at all is a Mait whose first checks are not due
   * yet. Rendering both as "0%" raises a false alarm on a platform ninety days old.
   */

  /** Where a rate stops being reassuring. Field conception rates sit in the 35–50% band. */
  const RATE_GOOD = 40;
  const RATE_POOR = 25;

  function rateTone(percent) {
    if (percent === null || percent === undefined) {
      return null;
    }
    if (percent >= RATE_GOOD) {
      return 'good';
    }
    return percent >= RATE_POOR ? 'warn' : 'bad';
  }

  function rateCell(row) {
    if (row.conception_rate === null || row.conception_rate === undefined) {
      // Said in words rather than left as a dash: a dash reads as data that failed to load,
      // and this is a Mait whose round has simply not come round yet.
      return (
        '<span class="table__sub">' +
        (row.open ? 'Nothing settled yet' : 'No checks yet') +
        '</span>'
      );
    }
    return (
      '<span class="rate">' +
      '<span class="rate__line">' +
      '<span class="rate__value">' +
      row.conception_rate.toFixed(1) +
      '%</span>' +
      // The fraction behind the percentage, because 50% of two inseminations and 50% of two
      // hundred are not the same claim and the bar cannot tell them apart.
      '<span class="rate__of">' +
      ui.number(row.conceived) +
      ' of ' +
      ui.number(row.decided) +
      '</span>' +
      '</span>' +
      // Under the figures rather than beside them: a bar the width of the cell is a length
      // worth comparing down the column, and the 64px track it used to sit in was narrower
      // than the bar's own minimum, which is what pushed this table past its panel.
      ui.bar(row.conception_rate, rateTone(row.conception_rate)) +
      '</span>'
    );
  }

  /* --- the table ------------------------------------------------------------------------ */

  function row(holder) {
    // Yellow, not red: an overdue check is waiting work, not blocked work. The Mait can still
    // record events; it is the animal's answer that is late.
    const cls = holder.overdue ? ' class="is-waiting"' : '';
    return (
      '<tr' +
      cls +
      ' data-mait="' +
      holder.mait_id +
      '">' +
      '<td>' +
      ui.identity(holder.name, holder.sahayak_vendor_code) +
      '</td>' +
      '<td>' +
      // Every code, not the first two: a Mait covering four MPPs and a Mait covering two read
      // identically once the list is silently cut, and which villages a round spans is half of
      // why an admin opens this screen. Chips rather than a comma list, so the count is
      // countable at a glance.
      (holder.mpp_codes.length
        ? '<span class="mpp-codes">' +
          holder.mpp_codes
            .map(function (code) {
              return '<span class="mpp-codes__code">' + ui.escapeHtml(code) + '</span>';
            })
            .join('') +
          '</span>'
        : '<span class="table__sub">None</span>') +
      '</td>' +
      '<td class="table__num">' +
      ui.number(holder.open) +
      '</td>' +
      '<td class="table__num">' +
      (holder.overdue ? ui.pill(ui.number(holder.overdue), 'warn') : '0') +
      '</td>' +
      '<td class="table__num">' +
      ui.number(holder.recorded) +
      '</td>' +
      '<td>' +
      rateCell(holder) +
      '</td>' +
      '<td><button class="btn" type="button" data-open="' +
      holder.mait_id +
      '">Round</button></td>' +
      '</tr>'
    );
  }

  function visibleRows() {
    const term = ($('#search').val() || '').trim().toLowerCase();
    let rows = state.rows;

    if (term) {
      rows = rows.filter(function (holder) {
        return (
          String(holder.name).toLowerCase().indexOf(term) >= 0 ||
          String(holder.sahayak_vendor_code).toLowerCase().indexOf(term) >= 0 ||
          holder.mpp_codes.join(' ').toLowerCase().indexOf(term) >= 0
        );
      });
    }

    return state.overdueFirst
      ? rows
      : rows.slice().sort(function (a, b) {
          return String(a.name).localeCompare(String(b.name));
        });
  }

  function render() {
    // Until the first response lands there is nothing to have matched, and saying "no Maits
    // match" is a claim the screen cannot make yet. Typing into the search box while the
    // request was still in flight turned the Loading row into an empty result, which reads as
    // a portal that has answered — and answered wrongly. The table is 62 Maits and a rate
    // computed over every chain, so the window is wide enough to type into.
    if (!state.loaded) {
      ui.rows($('#rows'), [], row, 'Loading…', 7);
      return;
    }
    ui.rows($('#rows'), visibleRows(), row, 'No Maits match that search.', 7);
  }

  /* --- one Mait's round -----------------------------------------------------------------
   * The table says how many; this says which animals, and it is what an admin reads down the
   * phone to the Mait it belongs to.
   */

  // A refusal is neutral, not red. Red on this screen means the insemination failed, and an
  // owner who would not have the animal examined has told us nothing about whether it did.
  const OUTCOME_TONE = {
    pregnant: 'good',
    not_pregnant: 'bad',
    unsure: 'warn',
    declined: null,
  };

  /** "1 day", "11 days". A badge reading "1 days overdue" is a badge nobody wrote on purpose. */
  function days(count) {
    return count + (count === 1 ? ' day' : ' days');
  }

  function dueBadge(check) {
    if (check.outcome) {
      return ui.pill(check.outcome_display, OUTCOME_TONE[check.outcome] || 'info');
    }
    const until = check.days_until;
    if (until < 0) {
      return ui.pill(days(Math.abs(until)) + ' overdue', 'warn');
    }
    if (until === 0) {
      return ui.pill('Due today', 'info');
    }
    return ui.pill('In ' + days(until), 'info');
  }

  /**
   * Which tint the card wears.
   *
   * The tint groups and the pill names — an admin scanning a round of a dozen animals should
   * be able to see the shape of it (four yellow, two green, one red) before reading a word.
   * An open check that is not yet overdue stays white on purpose: nothing is wrong with it.
   */
  function cardTone(check) {
    if (check.outcome) {
      return (
        {
          pregnant: ' check--pregnant',
          not_pregnant: ' check--empty',
          unsure: ' check--unsure',
          // The same grey as "not sure", because it settled just as little. What separates
          // the two is the pill, and the row of facts underneath saying nothing was found.
          declined: ' check--unsure',
        }[check.outcome] || ''
      );
    }
    return check.days_until < 0 ? ' check--late' : '';
  }

  /**
   * The pin, in the form a dispute is settled on.
   *
   * Hemispheres are computed rather than assumed. Every MPP on this platform is north and
   * east today, and a card that prints "° N" beside a negative number is a card that will be
   * believed anyway.
   */
  /** Null on an event captured before the handset sent a position. Zero is a real place. */
  function hasPin(check) {
    return (
      check.gps_lat !== null &&
      check.gps_lat !== undefined &&
      check.gps_lng !== null &&
      check.gps_lng !== undefined
    );
  }

  function coords(lat, lng) {
    return (
      Math.abs(lat).toFixed(4) +
      '° ' +
      (lat >= 0 ? 'N' : 'S') +
      ', ' +
      Math.abs(lng).toFixed(4) +
      '° ' +
      (lng >= 0 ? 'E' : 'W')
    );
  }

  /**
   * "98765 43210". Ten digits in one run is a string nobody reads back correctly down a phone,
   * and this number exists to be read back down a phone. Split 5–5, which is how an Indian
   * mobile is said out loud; anything that is not ten digits is left exactly as it came,
   * because a number this function does not recognise is one it must not reformat.
   */
  function phone(raw) {
    const digits = String(raw || '').replace(/\D/g, '');
    return digits.length === 10 ? digits.slice(0, 5) + ' ' + digits.slice(5) : String(raw || '');
  }

  const PHONE_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M7 3h3l1.6 4-2 1.4a12 12 0 0 0 5 5L16 11.4 20 13v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1' +
    ' 5 6.2 2 2 0 0 1 7 3"/></svg>';

  const PIN_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11M12 12a2.5 2.5 0 1 0 0-5 ' +
    '2.5 2.5 0 0 0 0 5"/></svg>';

  const DOC_SVG =
    '<svg class="btn__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M6 3h9l5 5v13H6zM14 3v6h6M9 14h7M9 18h5"/></svg>';

  /**
   * Where the check is, said twice.
   *
   * `mpp_name` is the collection point — the village. It is what the round is planned by and
   * it is not enough to find a yard with, which is the question an admin on the phone is
   * actually being asked. The coordinates under it are the event's own pin, recorded by the
   * handset at capture, and they are the answer.
   *
   * A pin lifted out of a chosen photograph's EXIF can be anywhere and any time, so it is
   * labelled rather than passed off as the handset's own reading.
   */
  function whereBlock(check) {
    const place =
      ui.escapeHtml(check.mpp_name || 'Unknown village') +
      (check.mpp_code ? ' · ' + ui.escapeHtml(check.mpp_code) : '');

    return (
      '<div class="check__where">' +
      '<span class="check__pin" aria-hidden="true">' +
      PIN_SVG +
      '</span>' +
      '<div class="check__place">' +
      '<p class="check__village">' +
      place +
      '</p>' +
      '<p class="check__coords">' +
      (hasPin(check)
        ? coords(Number(check.gps_lat), Number(check.gps_lng)) +
          (check.gps_source === 'exif' ? ' · from the photo' : '')
        : 'No pin was recorded') +
      '</p>' +
      '</div>' +
      '</div>'
    );
  }

  /**
   * Who this farmer is, on one line: kind, code, and a number to ring.
   *
   * It replaces a block of its own further down the card. That block repeated the word
   * "Member" directly under a line that already said "Member" — the card was introducing the
   * same fact twice and spending a rule and two lines of height to do it. Everything here
   * identifies the same person, so it belongs on the same line, and the line was already
   * there.
   *
   * Who she is and how to reach her are two groups on one wrapping row, and only the first
   * carries a middot. A separator between the code and the number looked right on a wide card
   * and left a dot dangling at the end of a wrapped line on every narrow one — and the number
   * carries its own glyph and its own colour, which sets it apart from the grey text beside
   * it better than punctuation did anyway.
   *
   * A member's code is sixteen digits and will not share a 250px card with a phone number, so
   * on a narrow card this is two lines — but two lines of one thought, in one place, rather
   * than two blocks pretending to be different subjects.
   *
   * **Why the number is here at all.** A check falls ninety days after the straw. By then the
   * animal may be at a relative's and the owner at market, and the Mait finds that out by
   * walking there. One call answers it, and the number used to live on another screen.
   *
   * `tel:` because on a desk with a softphone that dials, and everywhere else it is still
   * selectable text — which is what an admin reading it down the line to a Mait needs.
   */
  function ownerLine(check) {
    const isMember = check.owner_type === 'member';

    // Her member code is what the dairy's own office identifies her by, so it is what gets
    // read out when the call becomes "which AKANKSHA?" — and there are several.
    const who =
      isMember && check.member_code
        ? 'Member<span class="check__dot" aria-hidden="true">·</span>' +
          '<span class="check__code">' +
          ui.escapeHtml(check.member_code) +
          '</span>'
        : isMember
          ? 'Member'
          : 'Non-member';

    const reach = check.owner_mobile
      ? '<a class="check__phone" href="tel:' +
        encodeURIComponent(String(check.owner_mobile).replace(/\s/g, '')) +
        '">' +
        PHONE_SVG +
        ui.escapeHtml(phone(check.owner_mobile)) +
        '</a>'
      : // Said rather than left out: a member's number is optional in the SAP master, and a
        // line that simply stops reads as a field that failed to load.
        '<span class="check__phone--none">No number</span>';

    return (
      '<p class="check__owner-kind">' +
      '<span class="check__who-is">' +
      who +
      '</span>' +
      reach +
      '</p>'
    );
  }

  /**
   * The two things an admin does from a card, as buttons rather than as a sentence in link
   * blue. Opening the pin on a map is the whole point of carrying the coordinates, and half
   * the calls this panel is read during end on the insemination record.
   *
   * A colour each, because they go to two different kinds of place: the map is a reference
   * opened in somebody else's tab, and the insemination is this platform's own record. See
   * pregnancy.css.
   *
   * The map link is the same keyless Google URL the AI event screen uses, so one location
   * opens the same way from both screens. No map is framed here: a dozen cross-origin frames
   * in one panel is a dozen network requests for a picture nobody asked for yet.
   */
  function actions(check) {
    const point = hasPin(check) ? Number(check.gps_lat) + ',' + Number(check.gps_lng) : '';

    return (
      '<div class="check__actions">' +
      (point
        ? '<a class="btn check__btn check__btn--map" target="_blank" rel="noopener noreferrer" href="' +
          'https://www.google.com/maps/search/?api=1&query=' +
          encodeURIComponent(point) +
          '" aria-label="Open ' +
          ui.escapeHtml(point) +
          ' in Google Maps in a new tab">' +
          '<span class="btn__icon">' +
          PIN_SVG +
          '</span>Map</a>'
        : '') +
      '<a class="btn check__btn check__btn--event" href="ai-event.html?id=' +
      encodeURIComponent(check.ai_event_id) +
      '">' +
      DOC_SVG +
      'Insemination</a>' +
      '</div>'
    );
  }

  /**
   * "Buffalo · MURRAH". The species is spelled out the way `ai-events.js` and `products.js`
   * already spell it — `BUFF` is a database code and no admin should have to learn it — and
   * the breed is left exactly as the semen batch carries it, because that is the string
   * printed on the straw.
   */
  function animal(check) {
    const species = check.animal_type ? (check.animal_type === 'BUFF' ? 'Buffalo' : 'Cow') : '—';
    return species + (check.breed ? ' · ' + check.breed : '');
  }

  /**
   * A row of the card's table.
   *
   * `tone` is a class on the value, not on the pair: the label is furniture and always reads
   * the same, and it is the value that is a code, or missing, or ordinary.
   */
  function fact(label, value, tone) {
    return (
      '<dt>' +
      ui.escapeHtml(label) +
      '</dt><dd' +
      (tone ? ' class="' + tone + '"' : '') +
      '>' +
      ui.escapeHtml(value) +
      '</dd>'
    );
  }

  function checkCard(check) {
    const owner = check.owner_name || 'Unnamed';

    // The tag leads the table. It is the only line on the card that identifies the *animal*
    // rather than the visit, it is what the Mait is asked for when a farmer keeps four
    // buffalo, and it is read out digit by digit — so it is stated as a row of its own rather
    // than tucked under the owner's name where it used to sit.
    let rows =
      (check.ear_tag_no
        ? fact('Tag', check.ear_tag_no, 'fact--tag')
        : fact('Tag', 'Not tagged', 'fact--none')) +
      fact('Due', ui.date(check.due_on)) +
      fact('Served', ui.date(check.served_on)) +
      fact('Animal', animal(check));

    if (check.calving_due_on) {
      // The one fact on the card a farmer has already been told, so it is stated plainly and
      // never recomputed — the gestation constants will be revised and her month must not
      // silently move.
      rows += fact('Calving', ui.date(check.calving_due_on));
    }
    if (check.checked_at) {
      rows += fact('Checked', ui.dateTime(check.checked_at));
    }
    // What the visit cost, on the recorded ones only. Stamped at the time rather than
    // re-derived, so a row still shows what the farmer was actually quoted after the dairy
    // re-prices. A refused visit has none — nothing was examined, so nothing is billed — and
    // that is said in words rather than left as an empty cell.
    if (check.outcome) {
      rows += check.amount_charged
        ? fact('Charged', ui.money(Number(check.amount_charged)))
        : fact('Charged', check.outcome === 'declined' ? 'Nothing' : 'No rate set', 'fact--none');
    }

    return (
      '<article class="check' +
      cardTone(check) +
      '">' +
      '<div class="check__head">' +
      '<div class="check__who">' +
      '<p class="check__owner">' +
      ui.escapeHtml(owner) +
      '</p>' +
      ownerLine(check) +
      '</div>' +
      dueBadge(check) +
      '</div>' +
      // Bare `dt`/`dd` pairs, not a `div` around each: the grid that lines the two columns up
      // is on the list itself, and a wrapper would put every pair in one cell of it.
      '<dl class="check__facts">' +
      rows +
      '</dl>' +
      whereBlock(check) +
      (check.note ? '<p class="check__note">' + ui.escapeHtml(check.note) + '</p>' : '') +
      actions(check) +
      '</article>'
    );
  }

  function loadRound() {
    $('#round-body').html('<div class="round__skeleton"></div>'.repeat(3));

    MaitAI.api
      .maitPregnancyChecks(state.maitId, { window: state.window, limit: 100 })
      .done(function (data) {
        const summary = data.summary || {};
        const mait = data.mait || {};

        $('#round-title').text(mait.name + ' · ' + mait.sahayak_vendor_code);
        $('#round-count').html(
          ui.number(summary.open) +
            ' still owed · ' +
            (summary.overdue
              ? ui.pill(summary.overdue + ' overdue', 'warn')
              : ui.pill('None overdue', 'good')) +
            ' ' +
            (summary.conception_rate === null || summary.conception_rate === undefined
              ? ui.pill('No rate yet', null)
              : ui.pill(
                  summary.conception_rate.toFixed(1) + '% conceived',
                  rateTone(summary.conception_rate)
                ))
        );

        const checks = data.results || [];
        if (!checks.length) {
          $('#round-body').html(
            '<p class="round__empty">' +
              (state.window === 'done'
                ? 'Nothing recorded yet.'
                : 'Nothing owed — this round is clear.') +
              '</p>'
          );
          return;
        }

        $('#round-body').html(checks.map(checkCard).join(''));

        // The drill-down is capped rather than paged: a hundred cards is already more than
        // anyone reads down a phone, and the count above says how deep it really goes.
        const shown = checks.length;
        if ((data.count || shown) > shown) {
          $('#round-body').append(
            '<p class="round__more">Showing the first ' +
              ui.number(shown) +
              ' of ' +
              ui.number(data.count) +
              '.</p>'
          );
        }
      })
      .fail(function (problem) {
        $('#round-count').text('');
        $('#round-body').html('<p class="round__error">' + ui.escapeHtml(problem.detail) + '</p>');
      });
  }

  function showRound(maitId) {
    const holder = state.rows.filter(function (row_) {
      return row_.mait_id === maitId;
    })[0];

    state.maitId = maitId;
    state.window = 'due';
    $('#round').prop('hidden', false);
    $('#round-title').text(holder ? holder.name : 'Round');
    $('#round-count').text('');
    $('.round__tabs .chip')
      .removeClass('is-active')
      .attr('aria-selected', 'false')
      .filter('[data-window="due"]')
      .addClass('is-active')
      .attr('aria-selected', 'true');
    $('#round')[0].scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    loadRound();
  }

  /* --- load ----------------------------------------------------------------------------- */

  function load() {
    MaitAI.shell.clearAlert();
    MaitAI.api
      .pregnancyOversight()
      .done(function (data) {
        // The server already returns them most overdue first.
        state.loaded = true;
        state.rows = data.results || [];
        const summary = data.summary || {};

        $('#rate').text(
          summary.conception_rate === null || summary.conception_rate === undefined
            ? '—'
            : summary.conception_rate.toFixed(1) + '%'
        );
        $('#rate-foot').text(
          summary.decided
            ? ui.number(summary.conceived) +
                ' of ' +
                ui.number(summary.decided) +
                ' inseminations settled'
            : 'No insemination has an answer yet'
        );

        $('#overdue').text(ui.number(summary.overdue));
        $('#overdue-foot').text(
          summary.overdue ? 'Nobody has walked these' : 'Every round is up to date'
        );
        $('#due').text(ui.number(summary.due_this_week));
        $('#recorded').text(ui.number(summary.recorded));
        // Refusals are named, never added to "not". Folding them in would report an owner
        // who would not open the gate as an insemination that failed, and the two are the
        // opposite kind of news: one is about the animal, the other is about the round.
        $('#recorded-foot').text(
          ui.number(summary.pregnant) +
            ' pregnant · ' +
            ui.number(summary.not_pregnant) +
            ' not · ' +
            ui.number(summary.unsure) +
            ' unsure' +
            (summary.declined ? ' · ' + ui.number(summary.declined) + ' declined' : '')
        );
        $('#mait-count').text(ui.number(summary.maits));

        render();
      })
      .fail(function (problem) {
        // Loaded, in the sense that the screen has an answer: it failed. Left false, a search
        // typed after the failure would paint "Loading…" over the error.
        state.loaded = true;
        MaitAI.shell.alert(problem.detail);
        ui.rows($('#rows'), [], row, 'Could not load pregnancy checks.', 7);
      });
  }

  /**
   * Take the round away as a file.
   *
   * The report answers the question this screen can only answer one Mait at a time: **who
   * agreed to a check and who did not**, every farmer on one sheet, sortable. That is a
   * field-meeting document and a follow-up list, and neither is something anybody builds by
   * reading cards off a panel.
   *
   * It carries the search box with it. An admin who has typed a Mait's name and then exports
   * means that Mait — a file that quietly held all sixty-two would be the wrong document, and
   * they would not find out until they had sent it.
   */
  function exportReport() {
    MaitAI.shell.clearAlert();
    const term = ($('#search').val() || '').trim();
    const query = term ? '?search=' + encodeURIComponent(term) : '';

    $('#export').prop('disabled', true);
    $('#export-label').text('Preparing…');

    MaitAI.api
      .download('/reports/pregnancy/' + query, 'pregnancy-checks.csv')
      .catch(function () {
        MaitAI.shell.alert('The report could not be produced. Try again in a moment.');
      })
      .finally(function () {
        $('#export').prop('disabled', false);
        $('#export-label').text('Download report');
      });
  }

  $(function () {
    if (!MaitAI.shell.requireSession()) {
      return;
    }
    MaitAI.shell.mount();
    load();

    // Delegated: the table is rebuilt whenever the search or the sort changes.
    $('#rows').on('click', '[data-open]', function () {
      showRound(Number($(this).data('open')));
    });

    $('#round-close').on('click', function () {
      $('#round').prop('hidden', true);
      state.maitId = null;
    });

    $('.round__tabs').on('click', '.chip', function () {
      const $tab = $(this);
      state.window = String($tab.data('window'));
      $('.round__tabs .chip').removeClass('is-active').attr('aria-selected', 'false');
      $tab.addClass('is-active').attr('aria-selected', 'true');
      loadRound();
    });

    $('#search').on('input', render);

    $('#export').on('click', exportReport);

    $('#refresh').on('click', function () {
      load();
      if (state.maitId) {
        loadRound();
      }
    });

    $('#filter-overdue').on('click', function () {
      state.overdueFirst = !state.overdueFirst;
      $(this)
        .toggleClass('is-active', state.overdueFirst)
        .attr('aria-pressed', String(state.overdueFirst));
      render();
    });
  });
})(window.MaitAI, jQuery);
