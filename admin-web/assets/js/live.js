/**
 * Keeping a screen current while somebody is looking at it.
 *
 * The dashboard is left open all morning — on the operations desk and, at the plant, on a
 * screen on the wall. Without this it is a photograph: the figures are true at the moment
 * somebody last pressed F5 and quietly stop being true afterwards. That is worse than no
 * figures, because nothing on the page admits it, and the number an operator repeats down a
 * phone is whatever number they can see.
 *
 * A poll, not a socket. The API is Django under gunicorn with no ASGI layer and no broker
 * behind it (docs/ARCHITECTURE.md), so a push channel is a piece of infrastructure somebody
 * has to run forever in exchange for six numbers arriving a few seconds sooner. The reads
 * this drives are pre-aggregated — the §7 budget for them is 400ms — and those aggregate
 * tables exist precisely so this page can be asked often.
 *
 * What makes it safe to leave running for eight hours:
 *
 *   **Never stacked.** The next beat is scheduled when the previous one lands, never on a
 *   bare `setInterval`. An API answering slowly must not accumulate a queue of requests from
 *   a tab nobody is watching — the same reason uploads.js chains its own poll.
 *
 *   **Nothing at all happens in a background tab.** No timer is even pending: the screen is
 *   not being read, so the request is waste, and on a laptop it is waste that costs battery.
 *   Coming back to the tab fetches at once rather than waiting out a beat, which is what
 *   makes returning to the dashboard feel like it never left.
 *
 *   **It backs off when the server is unwell.** Doubling to a ceiling. Twenty dashboards
 *   open around an office all asking every thirty seconds is exactly the load a struggling
 *   API does not need, and a portal that hammers a service through an incident is part of
 *   the incident.
 *
 *   **It reports rather than repaints.** This module fetches and says what happened; the
 *   caller decides what the screen does about it. A failed beat is not an empty dashboard —
 *   the last good figures stay up, and the caller is told they are no longer fresh.
 *
 * Usage:
 *
 *     const live = MaitAI.live.create({ request: load, onState: paint }).start();
 *     live.refresh();   // now, because a person asked
 */

window.MaitAI = window.MaitAI || {};

(function (MaitAI, $) {
  'use strict';

  /** The beat. Often enough that a figure is never a minute old, rare enough to be free. */
  const DEFAULT_INTERVAL_MS = 30000;

  /** Where backing off stops. Five minutes is "checking occasionally", not "given up". */
  const MAX_BACKOFF_MS = 300000;

  /* Namespaces the window and document listeners per instance, so two loops on one page —
     or one stopped and another started — cannot unbind each other's handlers. */
  let instances = 0;

  /**
   * A polling loop that is not running yet.
   *
   * `request`  called for each beat; returns a promise that settles when the screen is up to
   *            date. Whatever it resolves with is ignored — rendering belongs to the caller,
   *            and keeping it there is what lets one screen fan out to two endpoints and
   *            another to one.
   * `onState`  told whenever the loop's state changes: `updating`, `live`, `stale`,
   *            `offline` or `paused`, with `{ lastOk, failures }`.
   * `onFail`   a beat that did not land, with the problem and how many have failed in a row.
   *            Separate from `onState` because the first miss is usually a laptop lid and the
   *            fifth is an outage, and only the caller knows how loudly to say either.
   * `held`     an extra reason to skip this beat — a dialog open over the screen, say. Asked
   *            per beat rather than subscribed to, so the caller keeps one source of truth
   *            instead of having to remember to tell us when it changes.
   */
  function create(options) {
    const intervalMs = options.intervalMs || DEFAULT_INTERVAL_MS;
    const onState = options.onState || function () {};
    const onFail = options.onFail || function () {};
    const held =
      options.held ||
      function () {
        return false;
      };
    const ns = '.live' + (instances += 1);

    const state = {
      timer: null,
      inFlight: false,
      failures: 0,
      lastOk: null,
      running: false,
      name: 'paused',
    };

    function announce(name) {
      state.name = name;
      onState(name, { lastOk: state.lastOk, failures: state.failures });
    }

    function clear() {
      if (state.timer) {
        window.clearTimeout(state.timer);
        state.timer = null;
      }
    }

    /** How long until the next beat: the interval, doubled per consecutive failure. */
    function wait() {
      if (!state.failures) {
        return intervalMs;
      }
      return Math.min(intervalMs * Math.pow(2, state.failures), MAX_BACKOFF_MS);
    }

    function schedule() {
      clear();
      if (state.running) {
        state.timer = window.setTimeout(beat, wait());
      }
    }

    function fetchNow() {
      // A beat arriving while the last one is still out is dropped rather than queued. It
      // would ask the same question and answer it a moment later with the same numbers.
      if (state.inFlight) {
        schedule();
        return;
      }
      state.inFlight = true;
      announce('updating');

      $.when(options.request())
        .done(function () {
          state.failures = 0;
          state.lastOk = new Date();
          announce('live');
        })
        .fail(function (problem) {
          state.failures += 1;
          announce('stale');
          onFail(problem, state.failures);
        })
        .always(function () {
          state.inFlight = false;
          schedule();
        });
    }

    function beat() {
      if (document.hidden) {
        // Not rescheduled. `visibilitychange` is what starts the loop again, and it does so
        // immediately — a pending timer here would only race it.
        clear();
        announce('paused');
        return;
      }
      if (navigator.onLine === false) {
        // A weak signal — it means "there is a network", not "the API answers" — so this is
        // a courtesy rather than the offline handling. A request fired down a dead
        // connection simply fails and backs off like any other.
        announce('offline');
        schedule();
        return;
      }
      if (held()) {
        // Held, not stopped: this beat is skipped and the next asked for as normal, so the
        // screen picks itself up on its own once whatever was holding it lets go.
        schedule();
        return;
      }
      fetchNow();
    }

    function bind() {
      $(document).on('visibilitychange' + ns, function () {
        if (document.hidden) {
          clear();
          announce('paused');
          return;
        }
        // Back in front of somebody. Anything older than one beat is refetched at once —
        // they are looking at it now, not in thirty seconds — and anything fresher than that
        // just restarts the clock.
        if (!state.lastOk || Date.now() - state.lastOk.getTime() >= intervalMs) {
          fetchNow();
        } else {
          schedule();
        }
      });

      $(window)
        .on('online' + ns, function () {
          // The connection is back, so whatever backoff the outage built up has stopped
          // describing anything true. The loop starts again from its normal beat.
          state.failures = 0;
          fetchNow();
        })
        .on('offline' + ns, function () {
          announce('offline');
        })
        // A request fired into a page being torn down cannot render anywhere. `pagehide`
        // rather than `unload`, because it also runs on the way into the back/forward cache.
        .on('pagehide' + ns, function () {
          clear();
          state.running = false;
        });
    }

    const live = {
      /**
       * Begin.
       *
       * The first load is the caller's own, deliberately: a screen paints itself once before
       * it starts keeping itself current, and it usually wants to show that first failure
       * differently. A dashboard that could not load at all is a different sentence from a
       * dashboard whose numbers have gone a minute stale.
       */
      start: function () {
        if (!state.running) {
          state.running = true;
          bind();
          schedule();
        }
        return live;
      },

      stop: function () {
        state.running = false;
        clear();
        $(document).off(ns);
        $(window).off(ns);
        return live;
      },

      /**
       * Fetch now, whatever the schedule said.
       *
       * For the things that make what is on screen wrong immediately — somebody clicking the
       * indicator, a filter changing under the same data — rather than leaving them looking
       * at the old answer until the beat comes round.
       */
      refresh: function () {
        clear();
        fetchNow();
        return live;
      },

      /** When the screen was last known to be right. `null` until the first beat lands. */
      lastOk: function () {
        return state.lastOk;
      },

      state: function () {
        return state.name;
      },
    };

    return live;
  }

  MaitAI.live = { create: create };
})(window.MaitAI, jQuery);
