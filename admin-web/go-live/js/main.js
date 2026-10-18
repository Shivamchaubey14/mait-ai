/**
 * MAIT AI — Go Live Event launch sequence.
 *
 * A three-state machine driven entirely through body[data-state]:
 *
 *   INTRO       the banner is at rest and the launch button is live
 *   LAUNCHING   the button is locked, the curtains draw open, poppers and confetti fire
 *   REDIRECTING the celebration has peaked; navigation to the real application begins
 *
 * The one and only destination is the live MAIT AI login page. Nothing here recreates it,
 * embeds it, or reads anything from it — the launch simply hands the browser over to it.
 */
(function () {
  'use strict';

  const DEST = 'https://mait-ai.shwetdharamilk.com:8001/login.html';

  const body = document.body;
  const btn = document.getElementById('launch-btn');
  const fxLayer = document.getElementById('fx-layer');
  const fallbackCta = document.getElementById('fallback-cta');
  const statusRegion = document.getElementById('status-region');

  // The fallback control points at the exact destination, so the page is useful even if
  // scripting breaks before the sequence ever runs.
  if (fallbackCta) {
    fallbackCta.setAttribute('href', DEST);
  }

  const reduceMotion =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Timeline, in ms from the click. Kept inside the 3–5s brief; collapsed hard when reduced
  // motion is requested so the launch still completes but without the elaborate sequence.
  const TIMING = reduceMotion
    ? { launch: 120, peak: 360, navigate: 760 }
    : { launch: 320, peak: 2600, navigate: 3800 };

  let state = 'intro';
  let timers = [];
  let navigated = false;

  function later(fn, ms) {
    const id = window.setTimeout(fn, ms);
    timers.push(id);
    return id;
  }

  function clearTimers() {
    timers.forEach(function (id) {
      window.clearTimeout(id);
    });
    timers = [];
  }

  function announce(msg) {
    if (statusRegion) {
      statusRegion.textContent = msg;
    }
  }

  // ---- Navigation -------------------------------------------------------------------
  // The real handover. Only ever runs once, and only after the sequence (or a fallback).
  function navigate() {
    if (navigated) {
      return;
    }
    navigated = true;
    try {
      window.location.assign(DEST);
    } catch (err) {
      // location.assign rarely throws, but if the handover cannot be initiated at all,
      // surface the manual control rather than leaving a dead page.
      showFallback();
    }
  }

  // Reveal the labelled manual control. Used as a safety net at the peak of the sequence
  // and as the recovery path if anything above goes wrong.
  function showFallback() {
    if (fallbackCta) {
      fallbackCta.hidden = false;
    }
  }

  // ---- Particle system ---------------------------------------------------------------
  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // Brand confetti palette: green and blue lead, with white and gold paper and a soft sky
  // tint. Green and gold are weighted a little heavier so the burst reads as MAIT AI's.
  const CONFETTI = [
    '#3bb77e',
    '#3bb77e',
    '#287d56',
    '#3e92e5',
    '#3e92e5',
    '#8fc3f2',
    '#ffffff',
    '#fdc040',
    '#fdc040',
    '#fed578',
  ];

  const KINDS = ['rect', 'rect', 'ribbon', 'paper', 'round'];

  // Scale the particle budget to the viewport: ~70–120 on a full display, fewer on a phone,
  // a small still burst under reduced motion. Never an unbounded count.
  function particleBudget() {
    const w = window.innerWidth;
    if (reduceMotion) {
      return 26;
    }
    if (w < 560) {
      return 54;
    }
    if (w < 960) {
      return 84;
    }
    return 116;
  }

  // Remove a particle once its animation ends so the DOM never accumulates. A timeout backs
  // up animationend for the case where it does not fire (e.g. the tab was backgrounded).
  function attachCleanup(el, lifespanMs) {
    let removed = false;
    function remove() {
      if (removed) {
        return;
      }
      removed = true;
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    }
    el.addEventListener('animationend', remove);
    later(remove, lifespanMs + 400);
  }

  // One confetti piece launched from a corner, sweeping inward and up with a varied arc.
  // `dir` is +1 for the left corner (sweeps right) and -1 for the right corner.
  function spawnConfetti(originXPct, dir) {
    const el = document.createElement('div');
    const kind = pick(KINDS);
    el.className = 'particle particle--' + kind;

    // A few deliberately larger celebratory shapes among the smaller paper.
    const big = Math.random() < 0.12;
    let w;
    let h;
    if (kind === 'ribbon') {
      w = rand(5, 9);
      h = rand(20, 34);
    } else if (kind === 'round') {
      w = rand(6, 11);
      h = w;
    } else if (big) {
      w = rand(16, 24);
      h = rand(18, 28);
    } else {
      w = rand(7, 14);
      h = rand(9, 18);
    }

    const dx = dir * rand(60, Math.max(140, window.innerWidth * 0.52));
    const dy = -rand(120, Math.max(260, window.innerHeight * 0.62));
    const dur = rand(2200, 3400);

    el.style.setProperty('--p-top', rand(58, 82) + '%');
    el.style.setProperty('--p-left', originXPct + '%');
    el.style.setProperty('--p-w', w + 'px');
    el.style.setProperty('--p-h', h + 'px');
    el.style.setProperty('--p-color', pick(CONFETTI));
    el.style.setProperty('--p-dx', dx + 'px');
    el.style.setProperty('--p-dy', dy + 'px');
    el.style.setProperty('--p-rot', dir * rand(360, 900) + 'deg');
    el.style.setProperty('--p-opacity', rand(0.85, 1).toFixed(2));
    el.style.setProperty('--p-dur', dur + 'ms');
    el.style.setProperty('--p-delay', rand(0, 240) + 'ms');

    fxLayer.appendChild(el);
    attachCleanup(el, dur + 240);
  }

  // A short radial popper flash at a corner.
  function spawnPopper(xPct, yPct) {
    const el = document.createElement('div');
    el.className = 'popper';
    el.style.left = xPct + '%';
    el.style.top = yPct + '%';
    fxLayer.appendChild(el);
    attachCleanup(el, 700);
  }

  // The full celebration: poppers fire from both lower corners, then confetti is released in
  // two waves so density briefly builds as the curtains reach full travel.
  function celebrate() {
    if (!fxLayer) {
      return;
    }

    spawnPopper(4, 88);
    spawnPopper(96, 88);
    later(function () {
      spawnPopper(7, 72);
      spawnPopper(93, 72);
    }, 180);

    const perSide = Math.floor(particleBudget() / 2);

    function wave(count) {
      for (let i = 0; i < count; i++) {
        spawnConfetti(rand(1, 10), 1); // left corner, sweeping right
        spawnConfetti(rand(90, 99), -1); // right corner, sweeping left
      }
    }

    const first = Math.ceil(perSide * 0.55);
    wave(first);
    if (!reduceMotion) {
      later(function () {
        wave(perSide - first);
      }, 520);
    }
  }

  // ---- The sequence ------------------------------------------------------------------
  function launch() {
    if (state !== 'intro') {
      return; // Repeated clicks can never restart the animation.
    }
    state = 'launching';

    try {
      // 1 + 2: lock the control and give the brief visual acknowledgement.
      btn.disabled = true;
      btn.setAttribute('aria-disabled', 'true');
      btn.classList.add('is-pressed');
      announce('Launching MAIT AI.');

      // 3–9: brighten, open the curtains, fire the celebration.
      later(function () {
        body.setAttribute('data-state', 'launching');
        celebrate();
      }, TIMING.launch);

      // At the visual peak: enter REDIRECTING and surface the manual control as a safety net
      // in case the environment prevents the automatic handover below.
      later(function () {
        state = 'redirecting';
        body.setAttribute('data-state', 'redirecting');
        showFallback();
        announce('Opening the MAIT AI application.');
      }, TIMING.peak);

      // 10: the automatic handover, after the transition has completed.
      later(navigate, TIMING.navigate);
    } catch (err) {
      // If anything in the sequence throws, do not strand the page: show the manual control
      // and hand over after a short fallback delay.
      showFallback();
      later(navigate, 900);
    }
  }

  // A hard watchdog independent of the sequence: whatever happens above, the browser is
  // handed over (or the fallback is visible) within a few seconds of the click.
  function armWatchdog() {
    later(function () {
      if (!navigated) {
        showFallback();
        navigate();
      }
    }, TIMING.navigate + 1500);
  }

  if (btn) {
    // A native <button> already fires click on Enter and Space, so one handler covers mouse
    // and keyboard activation alike.
    btn.addEventListener('click', function () {
      if (state !== 'intro') {
        return;
      }
      launch();
      armWatchdog();
    });
  } else {
    // No button in the DOM for some reason — expose the manual path immediately.
    showFallback();
  }

  // Free any pending timers if the page is being torn down.
  window.addEventListener('pagehide', clearTimers);
})();
