/**
 * SAP upload (W3).
 *
 * The Member master is 105,000+ rows and is parsed in the background, so the upload returns as
 * soon as the job is queued and the page polls for progress (SRS §6.1.6). Without a visible,
 * moving progress bar an operator closes the tab after two minutes and reports the import as
 * broken — while it is still running.
 *
 * All three masters can be in flight at once, so this renders one card per running import and
 * polls each on its own timer. The figure on a card is eased toward the last number the server
 * gave rather than written straight from the poll: progress arrives every two seconds in
 * chunks of a thousand rows, and printed raw it steps 1%, 12%, 23% and reads as a page
 * redrawing rather than as work happening.
 *
 * A failed row never stops the import. Everything valid lands and the rejects go to a report
 * keyed by the spreadsheet's own row numbers, so the fix happens in SAP against the file the
 * operator has open (W4).
 */

(function (MaitAI, $) {
  'use strict';

  const ui = MaitAI.ui;
  const LIMIT = 15;
  const POLL_MS = 2000;

  /* How much of the remaining gap the counter closes each frame. The percentage arrives in
     steps — a poll every two seconds, and the importer commits in chunks of a thousand rows —
     so writing it straight to the screen made the figure sit still and then jump 11 points.
     Easing toward the last known value turns the same data into a number that counts. */
  const EASE = 0.09;

  /* Runs in flight, keyed by the master being uploaded. Keyed by that rather than by upload id
     because a card exists before the POST has answered with an id, and because a second upload
     of the same master replaces the first rather than racing it. */
  const state = { offset: 0, runs: {}, frame: null };

  /**
   * The three cards, each pairing the URL a file is posted to with the type the history
   * reports back. They are not the same word — `POST /uploads/maits/` stores `mait` — and
   * treating them as one is why every card but MPP read "Never uploaded" after a good import.
   */
  const MASTERS = [
    { endpoint: 'members', type: 'member' },
    { endpoint: 'maits', type: 'mait' },
    { endpoint: 'mpp', type: 'mpp' },
  ];

  const STORED_TYPE = MASTERS.reduce(function (map, master) {
    map[master.endpoint] = master.type;
    return map;
  }, {});

  /* Keyed by what the API stores, not by what the endpoint is called. `assignment` is here
     because those uploads land in this history too — the Assignment screen posts them, and
     without the label this card's meta line opened with a bare separator. */
  const TYPE_LABEL = {
    member: 'Member',
    mait: 'Mait',
    mpp: 'MPP',
    assignment: 'Mait ↔ MPP assignment',
  };

  const STATUS_TONE = {
    completed: 'good',
    completed_with_errors: 'warn',
    processing: 'info',
    queued: 'info',
    failed: 'bad',
  };

  function row(upload) {
    const failed = upload.failed_rows || 0;
    return (
      '<tr' +
      (upload.status === 'failed' ? ' class="is-blocked"' : failed ? ' class="is-waiting"' : '') +
      '>' +
      '<td><span class="table__name">' +
      ui.escapeHtml(upload.file_name) +
      '</span></td>' +
      '<td>' +
      ui.escapeHtml(TYPE_LABEL[upload.upload_type] || upload.upload_type_display) +
      '</td>' +
      '<td class="table__num">' +
      ui.number(upload.total_rows) +
      '</td>' +
      '<td class="table__num">' +
      (failed
        ? '<a href="upload-errors.html?id=' + upload.id + '">' + ui.number(failed) + '</a>'
        : '—') +
      '</td>' +
      '<td>' +
      ui.dateTime(upload.finished_at) +
      '</td>' +
      '<td>' +
      ui.pill(upload.status_display, STATUS_TONE[upload.status]) +
      '</td>' +
      '</tr>'
    );
  }

  /* The four stages, in the order the importer passes through them. Built here rather than in
     the HTML because there is now one set per running card. */
  const STAGES = [
    { key: 'uploaded', label: 'Uploaded', path: 'M12 20V8m0 0-5 5m5-5 5 5M4 4h16' },
    {
      key: 'validated',
      label: 'Validated',
      path: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
    },
    {
      key: 'written',
      label: 'Written',
      path:
        'M12 7c4.4 0 8-1.1 8-2.5S16.4 2 12 2 4 3.1 4 4.5 7.6 7 12 7M4 4.5v15C4 20.9 7.6 22 12 22' +
        's8-1.1 8-2.5v-15M4 12c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5',
    },
    { key: 'report', label: 'Report', path: 'M6 3h9l5 5v13H6zM14 3v6h6M9 14h7M9 18h5' },
  ];

  function glyph(path, className) {
    return (
      '<svg class="' +
      className +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' +
      path +
      '"/></svg>'
    );
  }

  /** The card's markup. One per run, so every hook inside it is a class, not an id. */
  function cardHtml(key) {
    const stages = STAGES.map(function (item) {
      return (
        '<div class="stage" data-stage="' +
        item.key +
        '"><p class="tile__label">' +
        glyph(item.path, 'stage__icon') +
        ui.escapeHtml(item.label) +
        '</p><p class="stage__value" data-value="' +
        item.key +
        '">—</p></div>'
      );
    }).join('');

    return (
      '<section class="panel running" data-run="' +
      key +
      '"><div class="panel__head"><h2 class="panel__title">' +
      '<svg class="running__spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2.4" stroke-linecap="round" aria-hidden="true">' +
      '<path d="M12 3a9 9 0 1 0 9 9"/></svg><span data-title>Importing…</span></h2>' +
      // The figure changes every frame. Announcing it would make a screen reader read a
      // counter aloud for the length of a 105,000-row import; the meta line below carries the
      // same progress at poll rate, and that is the one marked as a status.
      '<span class="panel__count running__percent" data-percent aria-hidden="true">0%</span>' +
      '</div><p class="topbar__meta" data-meta role="status">—</p>' +
      '<div class="bar running__bar"><span class="bar__fill running__fill" data-fill></span>' +
      '</div><div class="stages">' +
      stages +
      '</div></section>'
    );
  }

  function $card(key) {
    let $el = $('[data-run="' + key + '"]');
    if (!$el.length) {
      $el = $(cardHtml(key)).appendTo('#runs');
    }
    return $el;
  }

  /**
   * Write one stage tile and colour it by where the import has got to.
   *
   * Blue while the import is inside that stage, green once it is past it. Four identical grey
   * figures cannot say which of the four is currently happening, which is the only thing an
   * operator watching this card wants to know.
   */
  function stage($el, key, value, tone) {
    $el
      .find('[data-value="' + key + '"]')
      .text(value)
      .closest('.stage')
      .removeClass('is-live is-done')
      .addClass(tone || '');
  }

  /**
   * Paint everything about a run except the moving figure, which the animation owns.
   *
   * Called on every poll. The percentage it computes is a *target*; `tick` walks the displayed
   * number toward it so the card counts between polls instead of stepping.
   */
  function renderRun(run) {
    const $el = $card(run.key);
    const total = run.total || 0;
    const reading = !total || run.processed < total;

    $el
      .find('[data-title]')
      .text((run.sending ? 'Sending ' : 'Importing ') + run.fileName + ' — do not close this tab');
    $el
      .find('[data-meta]')
      .text(
        (TYPE_LABEL[run.type] || '') +
          ' · ' +
          (run.sending
            ? ui.number(run.sentPercent || 0) + '% of the file sent'
            : total
              ? ui.number(total) + ' rows'
              : 'counting rows') +
          ' · started ' +
          ui.dateTime(run.startedAt)
      );

    // The indeterminate stripe belongs on the track, not on the fill inside it.
    $el.find('[data-fill]').closest('.bar').toggleClass('is-indeterminate', run.sending);

    stage(
      $el,
      'uploaded',
      run.sending ? 'Sending' : 'Received',
      run.sending ? 'is-live' : 'is-done'
    );
    stage(
      $el,
      'validated',
      ui.number(run.processed) + (total ? ' of ' + ui.number(total) + ' read' : ' rows read'),
      run.sending ? '' : reading ? 'is-live' : 'is-done'
    );
    stage($el, 'written', ui.number(run.success) + ' written', reading ? '' : 'is-live');
    stage(
      $el,
      'report',
      run.failed ? ui.number(run.failed) + ' rejected' : 'Available when done',
      run.failed ? 'is-live' : ''
    );

    paint(run);
  }

  /** Write the currently displayed figure onto its card. */
  function paint(run) {
    const $el = $('[data-run="' + run.key + '"]');
    if (!$el.length) {
      return;
    }
    const whole = Math.round(run.shown);
    $el.find('[data-percent]').text(run.sending ? 'Sending…' : whole + '%');
    $el.find('[data-fill]').css('width', run.sending ? '' : run.shown.toFixed(1) + '%');
  }

  /**
   * Ease every run's figure toward the last number the server gave for it.
   *
   * One loop for all of them rather than a timer each: three imports running at once would
   * otherwise be three independent animations competing for the same frame.
   */
  function tick() {
    let moving = false;

    Object.keys(state.runs).forEach(function (key) {
      const run = state.runs[key];
      if (run.sending) {
        return;
      }
      const gap = run.target - run.shown;
      if (Math.abs(gap) < 0.05) {
        run.shown = run.target;
        return;
      }
      // Never backwards: a bar that retreats reads as work being undone.
      run.shown = Math.max(run.shown, run.shown + gap * EASE);
      paint(run);
      moving = true;
    });

    state.frame = moving ? window.requestAnimationFrame(tick) : null;
  }

  function animate() {
    if (state.frame === null) {
      state.frame = window.requestAnimationFrame(tick);
    }
  }

  /** Take one status payload into the run's state, then repaint. */
  function update(key, upload, extra) {
    const run = state.runs[key] || { key: key, shown: 0, target: 0 };
    run.id = upload.id || run.id;
    run.fileName = upload.file_name || run.fileName;
    run.type = upload.upload_type || run.type;
    run.startedAt = upload.created_at || run.startedAt;
    run.total = upload.total_rows || 0;
    run.processed = upload.processed_rows || 0;
    run.success = upload.success_rows || 0;
    run.failed = upload.failed_rows || 0;
    run.sending = Boolean((extra || {}).sending);
    run.sentPercent = (extra || {}).sentPercent || 0;
    // High-water mark: a poll that arrives out of order must not walk the figure back.
    run.target = run.sending ? 0 : Math.max(run.target, upload.progress_percent || 0);

    state.runs[key] = run;
    renderRun(run);
    animate();
    return run;
  }

  /** Take a finished run off the screen, and stop everything still running for it. */
  function finish(key) {
    const run = state.runs[key];
    if (run) {
      window.clearTimeout(run.timer);
      delete state.runs[key];
    }
    $('[data-run="' + key + '"]').remove();
  }

  /**
   * Ask once, now, and decide what to do with the answer.
   *
   * Called straight after the POST as well as on every tick. The POST answers 202 with the row
   * as it was created — queued, no rows counted — so rendering that and then waiting a whole
   * interval before asking again means a quick file sits at 0% for two seconds and then simply
   * vanishes. Which is exactly what it does with CELERY_TASK_ALWAYS_EAGER set, as dev has it:
   * the import is already finished by the time the response arrives.
   */
  function check(key, id) {
    return MaitAI.api
      .uploadStatus(id)
      .done(function (upload) {
        if (['queued', 'processing'].indexOf(upload.status) >= 0) {
          update(key, upload);
          poll(key, id);
          return;
        }

        // Finished. Let the figure land before the card goes, so the last thing the operator
        // sees is the import completing rather than the card vanishing mid-count. Only when it
        // actually completed — a file rejected at row 900 did not reach 100% of anything, and
        // animating it there would be the card's final statement on the matter.
        update(key, upload);
        const run = state.runs[key];
        if (run && upload.status !== 'failed') {
          run.target = 100;
        }
        window.setTimeout(function () {
          finish(key);
          load();
          loadCards();
        }, 900);
      })
      .fail(function () {
        // A dropped poll is not a failed import. Stop asking and let the history show it.
        finish(key);
        load();
        loadCards();
      });
  }

  function poll(key, id) {
    const run = state.runs[key];
    if (!run) {
      return;
    }
    window.clearTimeout(run.timer);
    run.timer = window.setTimeout(function () {
      check(key, id);
    }, POLL_MS);
  }

  /**
   * The one-line summary under each card's title.
   *
   * "105,412 rows last time" tells the operator whether the file they are about to send is the
   * size they expect, before they send it. Asked per type rather than picked out of the history
   * page: a card must not claim a master was never uploaded because fifteen newer uploads of
   * another type pushed it onto page two.
   */
  function loadCards() {
    MASTERS.forEach(function (master) {
      const $meta = $('[data-last="' + master.type + '"]');
      MaitAI.api
        .uploadHistory({ upload_type: master.type, limit: 1 })
        .done(function (page) {
          const last = (page.results || [])[0];
          if (!last) {
            $meta.text('Never uploaded');
          } else if (last.status === 'failed') {
            $meta.text('Last attempt failed on ' + ui.dateTime(last.created_at));
          } else if (!last.finished_at) {
            $meta.text('Importing now — ' + ui.number(last.processed_rows) + ' rows read');
          } else {
            $meta.text(
              'Last: ' + ui.number(last.total_rows) + ' rows on ' + ui.date(last.finished_at)
            );
          }
        })
        .fail(function () {
          $meta.text('—');
        });
    });
  }

  function load() {
    MaitAI.api
      .uploadHistory({ limit: LIMIT, offset: state.offset })
      .done(function (page) {
        ui.rows($('#rows'), page.results, row, 'Nothing has been uploaded yet.', 6);
        ui.pager(
          $('#pager'),
          { count: page.count, limit: LIMIT, offset: state.offset },
          function (offset) {
            state.offset = offset;
            load();
          }
        );

        // Every running import, not the first one found: a reload mid-way through three
        // concurrent uploads has to come back showing all three.
        (page.results || []).forEach(function (upload) {
          if (['queued', 'processing'].indexOf(upload.status) < 0) {
            return;
          }
          const key = upload.upload_type;
          if (state.runs[key]) {
            return; // Already being watched by the card this page opened.
          }
          update(key, upload);
          poll(key, upload.id);
        });
      })
      .fail(function (problem) {
        MaitAI.shell.alert(problem.detail);
        ui.rows($('#rows'), [], row, 'Could not load the upload history.', 6);
      });
  }

  /* --- downloading a master --------------------------------------------------------------
   * The button used to say "Download templates" and then explain that there were none — the
   * templates are the SAP exports themselves, which is true and was no help to anybody. What
   * an admin actually wants before re-uploading a corrected master is the one currently in
   * force: open it, check a column, be sure the platform is running on what they think.
   *
   * So the modal offers the three masters and hands back the last upload that landed for
   * each, rebuilt and locked. The locking is the server's (`snapshots.py`); what is here is
   * the choosing, the progress and the honesty about which files exist.
   */

  // Derived from the list above rather than written out again. The two would drift the day a
  // fourth master arrives, and the failure would be a dialog quietly missing a row.
  const MASTER_TYPES = MASTERS.map(function (master) {
    return master.type;
  });

  /** "12 Aug 2026 · 105,433 rows · Member.xlsx" — provenance, in the order it gets asked. */
  function masterMeta(row) {
    if (!row.available) {
      // Not an error and not empty: a master nobody has uploaded yet is an ordinary state on
      // a fresh deployment, and the row should say which of the three it is waiting for.
      return 'Nothing uploaded yet';
    }
    return (
      ui.date(row.uploaded_at) +
      ' · ' +
      ui.number(row.success_rows) +
      (row.failed_rows ? ' of ' + ui.number(row.total_rows) : '') +
      ' rows · ' +
      row.file_name
    );
  }

  function paintMasters(rows) {
    rows.forEach(function (row) {
      $('[data-meta="' + row.upload_type + '"]').text(masterMeta(row));
      $('[data-get="' + row.upload_type + '"]').prop('disabled', !row.available);
    });
  }

  function openMasters() {
    const dialog = document.getElementById('masters');
    if (!dialog.open) {
      // `showModal`, not `show`: it is what makes the page behind inert and gives Escape its
      // meaning.
      dialog.showModal();
    }

    MASTER_TYPES.forEach(function (key) {
      $('[data-meta="' + key + '"]').text('Checking…');
      $('[data-get="' + key + '"]').prop('disabled', true);
      $('[data-bar="' + key + '"]')
        .prop('hidden', true)
        .removeClass('is-indeterminate');
      $('[data-fill="' + key + '"]').css('width', 0);
    });

    // Read on open rather than cached from page load: an upload may have finished in the
    // meantime, and a dialog offering yesterday's file is the specific mistake this feature
    // exists to prevent.
    MaitAI.api
      .uploadSnapshots()
      .done(function (data) {
        paintMasters(data.results || []);
      })
      .fail(function (problem) {
        MASTER_TYPES.forEach(function (key) {
          $('[data-meta="' + key + '"]').text('Could not check');
        });
        MaitAI.shell.alert(problem.detail);
      });
  }

  function closeMasters() {
    const dialog = document.getElementById('masters');
    if (dialog.open) {
      dialog.close();
    }
  }

  /**
   * A click on a dialog's backdrop is dispatched to the dialog element itself — there is no
   * backdrop node to listen on — so the hit has to be tested against its box. `e.target ===
   * dialog` alone would also fire on the dialog's own padding.
   */
  function backdropCloses(event) {
    const box = event.currentTarget.getBoundingClientRect();
    const outside =
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom;
    if (outside) {
      closeMasters();
    }
  }

  function downloadMaster(key) {
    const $button = $('[data-get="' + key + '"]').prop('disabled', true);
    const $bar = $('[data-bar="' + key + '"]').prop('hidden', false);
    const $fill = $('[data-fill="' + key + '"]').css('width', 0);

    MaitAI.api
      .download('/admin/uploads/snapshots/' + key + '/', key + '-master.xlsx', function (fraction) {
        // `null` means the length was not sent, so there is no fraction to draw. A stripe
        // that travels says "working" honestly; a guessed percentage does not.
        if (fraction === null) {
          $bar.addClass('is-indeterminate');
          return;
        }
        $bar.removeClass('is-indeterminate');
        $fill.css('width', Math.round(fraction * 100) + '%');
      })
      .then(function () {
        $fill.css('width', '100%');
        // Left on screen for a moment rather than cleared on the same frame: a bar that
        // vanishes the instant it fills never showed the operator that it finished.
        window.setTimeout(function () {
          $bar.prop('hidden', true).removeClass('is-indeterminate');
          $fill.css('width', 0);
        }, 900);
      })
      .catch(function () {
        $bar.prop('hidden', true).removeClass('is-indeterminate');
        MaitAI.shell.alert('That master could not be prepared. Try again in a moment.');
      })
      .finally(function () {
        $button.prop('disabled', false);
      });
  }

  $(function () {
    if (!MaitAI.shell.requireSession()) {
      return;
    }
    MaitAI.shell.mount();
    load();
    loadCards();

    $('[data-upload]').on('change', function () {
      const endpoint = $(this).data('upload');
      const file = this.files && this.files[0];
      if (!file) {
        return;
      }
      MaitAI.shell.clearAlert();

      // One card per master, so choosing all three files in turn gives three cards that run
      // side by side rather than three uploads fighting over one.
      const key = STORED_TYPE[endpoint];
      finish(key); // A repeat send of the same master replaces its card rather than racing it.

      // Painted before the request leaves, then repainted as the file goes up. A small master
      // finishes sending in one event, so a card painted only from the transfer callback is a
      // card the operator never sees. See the same note on the Assignment screen.
      const startedAt = new Date().toISOString();
      const blank = {
        file_name: file.name,
        upload_type: key,
        progress_percent: 0,
        total_rows: 0,
        processed_rows: 0,
        success_rows: 0,
        failed_rows: 0,
        created_at: startedAt,
      };
      const sending = function (percent) {
        update(key, blank, { sending: true, sentPercent: percent || 0 });
      };
      sending(0);

      MaitAI.api
        .uploadMaster(endpoint, file, sending)
        .done(function (upload) {
          update(key, upload);
          check(key, upload.id);
          load();
          loadCards();
        })
        .fail(function (problem) {
          finish(key);
          MaitAI.shell.alert(MaitAI.api.problemToLines(problem).join(' · '));
        });

      // Cleared so re-choosing the same file fires a change event again — otherwise a retry
      // after a rejected upload silently does nothing.
      this.value = '';
    });

    $('#templates').on('click', openMasters);
    $('#masters-close').on('click', closeMasters);
    $('#masters').on('click', backdropCloses);
    $('#masters').on('click', '[data-get]', function () {
      downloadMaster(String($(this).data('get')));
    });
  });
})(window.MaitAI, jQuery);
