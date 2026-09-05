/**
 * Rendering helpers shared by every list screen.
 *
 * Ten tables that each format their own dates and build their own pager is ten places for
 * "05 Aug 2026" to quietly become "2026-08-05" on one screen only.
 */

window.MaitAI = window.MaitAI || {};

(function (MaitAI, $) {
  'use strict';

  const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];

  function escapeHtml(value) {
    return $('<div>')
      .text(value === null || value === undefined ? '' : String(value))
      .html();
  }

  // ------------------------------------------------------------------------------------
  // Rolling figures
  // ------------------------------------------------------------------------------------
  /**
   * Whether this person has asked their operating system for less movement.
   *
   * Read live rather than captured once: somebody turning the setting on part-way through a
   * morning should not have to reload to be taken at their word.
   */
  function stillness() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /**
   * The digits on one reel: nought to nine, and then nought again.
   *
   * That last one is the whole trick. A nine turning into a nought is a carry — the number
   * went up — and a reel holding only 0–9 has nowhere to go but backwards to reach it, so a
   * counter passing 19 would roll its units column the wrong way. The duplicate sits below
   * the nine, is rolled forward onto, and the reel is put back to the top with the transition
   * off once it lands. Nobody sees the join; the carry runs forwards.
   */
  const REEL = '01234567890';

  /** How far apart the columns start, and where the stagger stops growing. */
  const STAGGER_STEP = 34;
  const STAGGER_MAX = 5;

  /**
   * How long after a carry's roll should have finished to put the reel back without being told.
   *
   * A backstop, not the mechanism. `transitionend` is the mechanism, and it is not a promise:
   * it does not arrive for a transition that was interrupted, or one the browser declined to
   * run at all. A reel left parked on the duplicate nought still *reads* correctly, so nothing
   * looks wrong — and then its next move takes the long way round through all ten digits,
   * which is a bug nobody can explain afterwards. Whichever of the two arrives first does the
   * work and cancels the other.
   *
   * Added to the reel's *own* measured duration and delay rather than to a number written down
   * here. A backstop with a guess about the stylesheet inside it is a backstop that fires
   * halfway through the roll the day somebody slows the motion token down — cutting off the
   * animation it exists to protect, which is a far worse failure than the one it prevents.
   */
  const CARRY_GRACE_MS = 250;

  /** The bare number inside a formatted figure, or NaN where there is not one. */
  function numberIn(text) {
    const digits = String(text === null || text === undefined ? '' : text).replace(/[^\d.]/g, '');
    return digits === '' ? NaN : Number(digits);
  }

  function buildDigit() {
    const $reel = $('<span class="odo__reel"></span>');
    REEL.split('').forEach(function (digit) {
      $reel.append($('<span class="odo__cell"></span>').text(digit));
    });
    // Every new column starts at nought and is rolled to its value, so a figure arriving for
    // the first time spins up rather than being placed there — and a digit gained on the left
    // as 999 becomes 1,000 arrives the same way as the ones that carried into it.
    //
    // Stated rather than left to the fallback in the stylesheet, so a reel's declared position
    // and the digit it believes it is showing never disagree — including for a column that
    // opens on a nought and is therefore never rolled at all.
    $reel[0].__d = 0;
    $reel[0].style.setProperty('--p', 0);
    return $('<span class="odo__digit"></span>').append($reel);
  }

  /**
   * Move a reel to a position, with the transition or without it.
   *
   * The class comes off *before* the position changes on the animated path. A transition
   * switched on in the same style recalculation as the value it would carry is a transition
   * some browsers never start, and the digit lands silently.
   */
  function place($reel, position, animate) {
    const reel = $reel[0];

    if (!animate) {
      $reel.addClass('odo__reel--still');
      reel.style.setProperty('--p', position);
      // Flushed while the transition is still switched off, so this position is *committed*
      // rather than becoming the destination of an animation the moment the class comes back.
      void reel.offsetWidth;
      return;
    }

    if ($reel.hasClass('odo__reel--still')) {
      $reel.removeClass('odo__reel--still');
      void reel.offsetWidth;
    }
    reel.style.setProperty('--p', position);
  }

  /** Forget a carry's pending cleanup, however it was going to arrive. */
  function unpark($reel) {
    $reel.off('transitionend.odo');
    if ($reel[0].__park) {
      window.clearTimeout($reel[0].__park);
      $reel[0].__park = null;
    }
  }

  /** A computed CSS time — "0.42s", "120ms", or a list of them — in milliseconds. */
  function millis(value) {
    const first = String(value || '')
      .split(',')[0]
      .trim();
    const amount = parseFloat(first) || 0;
    return /ms$/.test(first) ? amount : amount * 1000;
  }

  /** Put a reel that has rolled onto the duplicate nought back to the real one at the top. */
  function park($reel) {
    const style = window.getComputedStyle($reel[0]);
    const done = function () {
      unpark($reel);
      place($reel, 0, false);
    };
    $reel.one('transitionend.odo', done);
    $reel[0].__park = window.setTimeout(
      done,
      millis(style.transitionDuration) + millis(style.transitionDelay) + CARRY_GRACE_MS
    );
  }

  function rollDigit($digit, to, rising) {
    const $reel = $digit.children('.odo__reel');
    const reel = $reel[0];
    const from = reel.__d;

    // A cleanup still pending from a carry that has not finished. Dropped rather than left to
    // fire: it would snap this reel back to nought half way through its next move.
    unpark($reel);

    if (from === to) {
      return;
    }
    reel.__d = to;

    if (stillness()) {
      place($reel, to, false);
      return;
    }

    if (rising && from === 9 && to === 0) {
      // Forward, onto the duplicate nought below the nine, and back to the top once there.
      place($reel, 10, true);
      park($reel);
      return;
    }

    if (!rising && from === 0 && to === 9) {
      // The same join, used the other way: start from the duplicate so the reel can travel
      // backwards onto the nine above it rather than the long way down through the whole set.
      place($reel, 10, false);
      place($reel, 9, true);
      return;
    }

    place($reel, to, true);
  }

  function roll($el, text) {
    const node = $el && $el[0];
    if (!node) {
      return;
    }

    const value = String(text === null || text === undefined ? '' : text);
    if (node.__odoText === value) {
      return;
    }

    const before = numberIn(node.__odoText);
    const after = numberIn(value);
    // An unknown direction counts as rising: a tile coming off its em dash for the first time
    // is a counter starting up, and it should spin the way one does.
    const rising = !isFinite(before) || !isFinite(after) ? true : after >= before;

    let $odo = $el.children('.odo');
    if (!$odo.length) {
      $el.empty();
      $odo = $('<span class="odo" aria-hidden="true"></span>').appendTo($el);
      $('<span class="visually-hidden"></span>').appendTo($el);
    }

    // Slots are matched from the right, so place value is what survives a figure changing
    // length: 999 becoming 1,000 keeps the three columns it already had — they carry to nought
    // together — and builds only the thousand and its comma on the left. Matching from the
    // left would hand the units column to the thousands and roll every digit on the tile.
    const chars = value.split('');
    const previous = node.__odo || [];
    const slots = [];
    let spare = previous.length;

    for (let i = chars.length - 1; i >= 0; i -= 1) {
      const character = chars[i];
      const isDigit = character >= '0' && character <= '9';
      let slot = null;

      while (spare > 0) {
        const candidate = previous[spare - 1];
        spare -= 1;
        if (candidate.isDigit === isDigit) {
          slot = candidate;
          break;
        }
      }

      if (!slot) {
        slot = {
          isDigit: isDigit,
          $el: isDigit ? buildDigit() : $('<span class="odo__sep"></span>'),
        };
      }
      if (!isDigit) {
        slot.$el.text(character);
      }
      slot.character = character;
      slots.unshift(slot);
    }

    node.__odo = slots;
    node.__odoText = value;

    // Re-appending moves the columns that were kept rather than copying them, so a reel mid
    // roll keeps rolling. Anything left over from the old figure is dropped with the diff.
    $odo.children().detach();
    $odo.append(
      slots.map(function (slot) {
        return slot.$el[0];
      })
    );
    $el.children('.visually-hidden').text(value);

    // The columns just built have never been painted, and a browser does not transition an
    // element's first style. Committing them at nought here is what lets a figure arriving for
    // the first time spin up to its value instead of simply being there.
    void $odo[0].offsetWidth;

    // Least significant first. A carry starts in the units column and arrives at the tens a
    // moment later, which is the order the columns of a real counter move in — and the reason
    // the stagger is capped is that a seven-figure lifetime total should still finish moving
    // while somebody is looking at it.
    let column = 0;
    for (let i = slots.length - 1; i >= 0; i -= 1) {
      if (!slots[i].isDigit) {
        continue;
      }
      slots[i].$el.children('.odo__reel').css('--k', Math.min(column, STAGGER_MAX) * STAGGER_STEP);
      rollDigit(slots[i].$el, Number(slots[i].character), rising);
      column += 1;
    }
  }

  MaitAI.ui = {
    escapeHtml: escapeHtml,

    /** 31540 → "31,540". Indian grouping is not used: the reports are read alongside SAP. */
    number: function (value) {
      if (value === null || value === undefined || isNaN(value)) {
        return '—';
      }
      return Number(value).toLocaleString('en-IN');
    },

    money: function (value) {
      if (value === null || value === undefined || isNaN(value)) {
        return '—';
      }
      return '₹' + Number(value).toLocaleString('en-IN');
    },

    /** "05 Aug 09:14" — the form used on every screen in the portal. */
    dateTime: function (iso) {
      if (!iso) {
        return '—';
      }
      const d = new Date(iso);
      if (isNaN(d.getTime())) {
        return '—';
      }
      const pad = function (n) {
        return String(n).padStart(2, '0');
      };
      return (
        pad(d.getDate()) +
        ' ' +
        MONTHS[d.getMonth()] +
        ' ' +
        pad(d.getHours()) +
        ':' +
        pad(d.getMinutes())
      );
    },

    date: function (iso) {
      if (!iso) {
        return '—';
      }
      const d = new Date(iso);
      if (isNaN(d.getTime())) {
        return '—';
      }
      return (
        String(d.getDate()).padStart(2, '0') + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear()
      );
    },

    /** Whole days since a timestamp — how the exception screens express age. */
    daysAgo: function (iso) {
      if (!iso) {
        return null;
      }
      const then = new Date(iso).getTime();
      if (isNaN(then)) {
        return null;
      }
      return Math.max(0, Math.floor((Date.now() - then) / 86400000));
    },

    /**
     * A status pill.
     *
     * The label always carries the meaning. Colour reinforces it — an operator who cannot
     * distinguish the greens still reads the word.
     */
    pill: function (label, tone) {
      const suffix = tone ? ' pill--' + tone : '';
      return '<span class="pill' + suffix + '">' + escapeHtml(label) + '</span>';
    },

    /**
     * A figure that changes while somebody is watching it, shown the way a clock shows one.
     *
     * The dashboard re-reads itself every thirty seconds, so its numbers move on their own —
     * and a figure that swaps from 13 to 14 between two blinks has not been seen to change at
     * all. Somebody looks up, the tile says something different, and there is nothing to tell
     * them whether it just happened or happened ten minutes ago.
     *
     * So each digit is a reel and only the digits that changed move. It reads the way a clock
     * reads: the seconds column turns constantly, the hour column almost never, and the eye
     * learns to watch the one that is moving. A number counting up through every value in
     * between — the obvious alternative — says something different and slightly false: that
     * the figure passed through 1,704 on its way to 1,911, when nothing of the sort happened.
     *
     * Rolling forwards or backwards is not decoration either. A queue count coming down is
     * work being cleared, and it should not look identical to work arriving.
     *
     * `text` is already formatted — "1,911", "62.5%", "—". Commas, points and the em dash ride
     * along as fixed slots between the reels, so this makes no assumption about how a screen
     * writes its numbers.
     *
     * The whole thing is `aria-hidden`, with the plain value beside it: a reel is ten digits
     * stacked in the document and a screen reader would read all ten.
     */
    roll: function ($el, text) {
      roll($el, text);
    },

    bar: function (percent, tone) {
      const width = Math.max(0, Math.min(100, Number(percent) || 0));
      const suffix = tone ? ' bar__fill--' + tone : '';
      return (
        '<span class="bar"><span class="bar__fill' +
        suffix +
        '" style="width:' +
        width +
        '%"></span></span>'
      );
    },

    /**
     * A queue card's "Open" control, on or off.
     *
     * Both the dashboard and Exceptions render the same six cards, so the rule that decides
     * whether one is usable lives once.
     *
     * **A control that opens a dialog stays.** The rule below was written for links: an empty
     * queue has nothing to navigate to, and a link landing on a filtered list of nothing
     * teaches an operator it is a dead end. That reasoning inverts once the control opens the
     * queue *in place*, because the dialog is where the window is chosen — hiding it at zero
     * locked the operator out of the only control that would have shown them the fourteen
     * failures sitting just outside the card's week. The dialog says plainly that nothing is
     * waiting in this window, which is a better answer than a card with no way in.
     *
     * The count is shown either way: zero is an answer.
     */
    queueLink: function (name, count) {
      const $control = $('[data-link="' + name + '"]');
      const opensInPlace = $control.is('[data-queue]');
      const open = opensInPlace || (count || 0) > 0;
      $control.prop('hidden', !open).closest('.panel').toggleClass('panel--linked', open);
    },

    /** Identity cell: the name, with its code beneath in muted type. */
    identity: function (name, code) {
      return (
        '<span class="table__name">' +
        escapeHtml(name || '—') +
        '</span>' +
        (code ? '<span class="table__sub">' + escapeHtml(code) + '</span>' : '')
      );
    },

    /**
     * Fill a table body, or say plainly that there is nothing.
     *
     * An empty tbody reads as a portal that failed to load rather than a filter that matched
     * nothing, and the two need very different reactions from the operator.
     *
     * Clears `aria-busy` on the way. Every table ships with skeleton rows in its markup so
     * something is on screen at first paint (portal.css, `--- skeleton ---`); those rows are
     * `aria-hidden` and the body is marked busy, and this is the one place that knows the
     * wait is over — whether it ended in rows or in nothing.
     */
    rows: function ($tbody, items, rowFn, emptyMessage, columns) {
      $tbody.removeAttr('aria-busy');
      if (!items || !items.length) {
        $tbody.html(
          '<tr><td class="table__empty" colspan="' +
            (columns || 6) +
            '">' +
            escapeHtml(emptyMessage || 'Nothing to show.') +
            '</td></tr>'
        );
        return;
      }
      $tbody.html(items.map(rowFn).join(''));
    },

    /**
     * Limit/offset pager matching the API's pagination (docs/API_CONTRACT.md).
     *
     * Renders the surrounding page numbers rather than all of them: 31,540 events at 25 a
     * page is 1,262 buttons.
     */
    pager: function ($el, state, onPage) {
      const limit = state.limit || 25;
      const count = state.count || 0;
      const offset = state.offset || 0;
      const pages = Math.max(1, Math.ceil(count / limit));
      const current = Math.floor(offset / limit) + 1;

      if (!count) {
        $el.empty();
        return;
      }

      const window_ = [];
      for (let p = Math.max(1, current - 2); p <= Math.min(pages, current + 2); p += 1) {
        window_.push(p);
      }

      const buttons = window_
        .map(function (page) {
          return (
            '<button type="button" class="pager__page' +
            (page === current ? ' is-current' : '') +
            '" data-page="' +
            page +
            '">' +
            page +
            '</button>'
          );
        })
        .join('');

      const shown = Math.min(count, offset + limit) - offset;
      $el.html(
        '<span>Showing ' +
          MaitAI.ui.number(shown) +
          ' of ' +
          MaitAI.ui.number(count) +
          '</span>' +
          '<span class="pager__pages">' +
          '<button type="button" class="pager__page" data-page="' +
          (current - 1) +
          '"' +
          (current === 1 ? ' disabled' : '') +
          '>‹</button>' +
          buttons +
          '<button type="button" class="pager__page" data-page="' +
          (current + 1) +
          '"' +
          (current === pages ? ' disabled' : '') +
          '>›</button>' +
          '</span>'
      );

      $el.off('click.pager').on('click.pager', '.pager__page', function () {
        const page = Number($(this).data('page'));
        if (page >= 1 && page <= pages && page !== current) {
          onPage((page - 1) * limit);
        }
      });
    },
  };
})(window.MaitAI, jQuery);
