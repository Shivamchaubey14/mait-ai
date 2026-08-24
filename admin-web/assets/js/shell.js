/**
 * The portal shell: sidebar, active state, account menu, exceptions badge.
 *
 * Rendered from one list rather than copied into seventeen HTML files. A nav duplicated
 * across that many pages drifts within a week — a link is added to twelve of them, renamed on
 * three, and the one page that still says the old thing is the one someone reports as broken.
 *
 * Usage: give the page `<div class="shell" data-page="ai-events">` and include this script.
 */

window.MaitAI = window.MaitAI || {};

(function (MaitAI, $) {
  'use strict';

  /**
   * Icons as inline SVG paths, drawn in `currentColor`.
   *
   * No icon font and no sprite sheet: twelve glyphs do not justify another asset on a page
   * that must not load anything third-party, and inline paths inherit the link's colour for
   * free — including when it becomes the active green pill.
   */
  const ICONS = {
    dashboard: 'M3 3h7v7H3zM14 3h7v4h-7zM14 11h7v10h-7zM3 14h7v7H3z',
    uploads: 'M12 16V4m0 0L7 9m5-5 5 5M4 20h16',
    'ai-events': 'M8 3h8v4H8zM5 7h14v14H5zM9 12h6M9 16h4',
    maits: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M5 21a7 7 0 0 1 14 0',
    mpps: 'M4 21V9l8-5 8 5v12M9 21v-6h6v6',
    assignments: 'M12 21s7-5.3 7-11a7 7 0 1 0-14 0c0 5.7 7 11 7 11M12 10h.01',
    members:
      'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M3 20a6 6 0 0 1 12 0M17 11a3 3 0 1 0 0-6M21 20a6 6 0 0 0-4-5.6',
    /* An identity card with a face on it. Members are a roster — two people — because they
       arrive from SAP in their thousands. A non-member arrives one at a time, in a yard, and
       what makes her a record at all is the card the Mait photographed: that is the honest
       glyph for the section, and it cannot be mistaken for the two-person one above it. */
    'non-members':
      'M3 5h18v14H3zM8.5 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4M5.5 16.5a3 3 0 0 1 6 0M14.5 10h4M14.5 13.5h3',
    inventory: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
    products: 'M4 6h16M4 12h16M4 18h10M18 16v5M15.5 18.5h5',
    /* A price tag: the one section that is about money rather than about things or people. */
    rates: 'M20.6 13.4 12 22l-9-9V3h10zM7.5 7.5h.01',
    indents: 'M6 3h9l5 5v13H6zM14 3v6h6M9 13h7M9 17h5',
    leaderboard: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    /* A booked visit, not a medical glyph. Pregnancy diagnosis is a round somebody walks
       on a date — the section is about whether the visit happened, so it is a calendar
       with a tick in it rather than a stethoscope, which would read as the whole of
       animal health. */
    pregnancy: 'M4 5h16v16H4zM4 9h16M8 3v4M16 3v4M9.5 14.5l2 2 3.5-4',
    exceptions: 'M12 3 2 20h20zM12 9v5M12 17.5v.5',
    reports: 'M6 3h9l5 5v13H6zM14 3v6h6M9 14h7M9 18h7',
    users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M2 20a7 7 0 0 1 14 0M18 8v6M15 11h6',

    /* Not sidebar sections: the filter bar's magnifier and the four notice tones. */
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14M20 20l-4.3-4.3',
    /* Waiting, as opposed to wrong. The dashboard already draws this one for "Lifetime"; an
       event still moving through the flow needs it too, and a warning triangle would say the
       event had gone wrong rather than that it had not finished. */
    clock: 'M3 12a9 9 0 1 0 2.6-6.4L3 8M3 3v5h5M12 7.5V12l3.5 2',
    info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 11v5.5M12 7.5v.5',
    warn: 'M12 3 2 20h20zM12 9v5M12 17.5v.5',
    bad: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M9 9l6 6M15 9l-6 6',
    good: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M8 12.5l2.5 2.5L16 9.5',
  };

  /* Which glyph a notice gets, by the tone modifier already on it. */
  const NOTICE_ICON = { 'notice--warn': 'warn', 'notice--bad': 'bad', 'notice--good': 'good' };

  /* Order is the order they appear. `key` matches the page's data-page attribute. */
  const SECTIONS = [
    { key: 'dashboard', label: 'Dashboard', href: 'index.html' },
    { key: 'uploads', label: 'SAP upload', href: 'uploads.html' },
    { key: 'ai-events', label: 'AI events', href: 'ai-events.html' },
    { key: 'maits', label: 'Maits', href: 'maits.html' },
    { key: 'mpps', label: 'MPPs', href: 'mpps.html' },
    { key: 'assignments', label: 'Assignment', href: 'assignments.html' },
    { key: 'members', label: 'Members', href: 'members.html' },
    // Directly under Members: they are the same question — who is this farmer — answered from
    // two different rosters, and a Mait's field registrations belong beside the SAP master
    // rather than filed among the operational screens further down.
    { key: 'non-members', label: 'Non-members', href: 'non-members.html' },
    { key: 'inventory', label: 'Inventory', href: 'inventory.html' },
    { key: 'products', label: 'Products', href: 'products.html' },
    { key: 'rates', label: 'Rates', href: 'rates.html' },
    { key: 'indents', label: 'Indents', href: 'indents.html' },
    { key: 'leaderboard', label: 'Leaderboard', href: 'leaderboard.html' },
    // After the leaderboard and before the exception queues: it is the other half of how
    // a Mait is judged. The leaderboard counts what was sold, this counts what it
    // achieved, and reading one without the other is how volume gets rewarded on its own.
    { key: 'pregnancy', label: 'Pregnancy', href: 'pregnancy.html' },
    { key: 'exceptions', label: 'Exceptions', href: 'exceptions.html', badge: true },
    { key: 'reports', label: 'Reports', href: 'reports.html' },
    { key: 'users', label: 'Users & roles', href: 'users.html' },
  ];

  /* `className` is optional — a notice's glyph is sized by its container, not by a class. */
  function icon(key, className) {
    return (
      '<svg' +
      (className ? ' class="' + className + '"' : '') +
      ' viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="' +
      (ICONS[key] || '') +
      '" /></svg>'
    );
  }

  function escapeHtml(value) {
    return $('<div>')
      .text(value === null || value === undefined ? '' : String(value))
      .html();
  }

  function renderSidebar(active) {
    const links = SECTIONS.map(function (section) {
      const isActive = section.key === active;
      return [
        '<a class="side__link' + (isActive ? ' is-active' : '') + '"',
        ' href="' + section.href + '"' + (isActive ? ' aria-current="page"' : '') + '>',
        icon(section.key, 'side__icon'),
        '<span class="side__label">' + escapeHtml(section.label) + '</span>',
        section.badge ? '<span class="side__badge" id="exception-badge" hidden>0</span>' : '',
        '</a>',
      ].join('');
    }).join('');

    return [
      '<aside class="side">',
      // `.brand` is the shared wordmark (brand.css) — the same tile sign-in shows, so the
      // portal does not appear to change product the moment someone logs in.
      '<div class="brand side__mark">',
      '<span class="brand__name">MAIT AI</span>',
      '<span class="brand__sub">ADMIN PORTAL</span>',
      '</div>',
      '<nav aria-label="Main">' + links + '</nav>',
      '</aside>',
    ].join('');
  }

  /**
   * Fill the icon slots the shared components leave empty.
   *
   * A notice already carries its tone in its markup and a filter search box is the same box on
   * every screen, so the glyph is decided here rather than pasted into eleven HTML files —
   * the same reason the sidebar is not copied into them. Both are decorative and marked
   * `aria-hidden`: the notice's words and the field's own label carry the meaning.
   */
  function decorate() {
    $('.notice__icon').each(function () {
      const $slot = $(this);
      if ($slot.children().length) {
        return;
      }
      const $notice = $slot.closest('.notice');
      const tone = Object.keys(NOTICE_ICON).filter(function (cls) {
        return $notice.hasClass(cls);
      })[0];
      $slot.html(icon(NOTICE_ICON[tone] || 'info'));
    });

    $('.filters__search').each(function () {
      const $input = $(this);
      if ($input.parent().hasClass('search')) {
        return;
      }
      $input.wrap('<div class="search"></div>').before(icon('search', 'search__icon'));
    });

    // Selects and date fields are replaced outright — see controls.js. Styling the closed box
    // never reached the menu or the calendar that drops out of it, because the browser draws
    // those outside the page.
    if (MaitAI.controls) {
      MaitAI.controls.mount();
    }
  }

  /**
   * Sign the user out and return to login.
   *
   * Clears the tokens whether or not the blacklist call succeeds — a refresh token this
   * browser can no longer reach is less dangerous than one left in session storage on a
   * shared back-office machine.
   */
  function wireAccount() {
    $(document).on('click', '#account', function () {
      MaitAI.api.logout().always(function () {
        window.location.href = 'login.html';
      });
    });
  }

  MaitAI.shell = {
    sections: SECTIONS,
    escapeHtml: escapeHtml,

    /**
     * One glyph from the portal's set, drawn in `currentColor`.
     *
     * Exposed for the slots a page can only fill once it knows what it is showing — the event
     * detail screen cannot put a tick on the Status tile in HTML, because the event might be
     * cancelled. Pages whose glyph is fixed still write the `<svg>` inline, the way the
     * dashboard's tiles do; there is no need for script to draw something that never changes.
     */
    icon: icon,

    /**
     * One query parameter, or ''.
     *
     * Exceptions and the dashboard link into the screens where a queue is actually worked, and
     * a link that lands on an unfiltered roster of 1,900 Maits has answered a different
     * question than the one that was clicked. The filter travels in the URL so the deep link
     * is also shareable and survives a refresh.
     */
    param: function (name) {
      return new URLSearchParams(window.location.search).get(name) || '';
    },

    /** Insert the sidebar, mark the current section, and fill the shared icon slots. */
    mount: function () {
      const $shell = $('.shell');
      const active = $shell.data('page');
      $shell.prepend(renderSidebar(active));
      wireAccount();
      decorate();
      return active;
    },

    /** Re-run the icon slots after a screen has rendered notices of its own. */
    decorate: decorate,

    /**
     * Send anyone without a session to login before the page renders anything.
     *
     * The API would reject the requests anyway; this is so a back-office user sees a login
     * form rather than a screenful of empty tables and an error.
     */
    requireSession: function () {
      if (!MaitAI.api.tokens.get().access) {
        window.location.href = 'login.html';
        return false;
      }
      return true;
    },

    /** Update the count of things needing a human, shown on every screen. */
    setExceptionCount: function (count) {
      const $badge = $('#exception-badge');
      if (!$badge.length) {
        return;
      }
      $badge.text(count).prop('hidden', !count);
    },

    /**
     * Show a page-level message without leaving the operator looking at a blank table.
     *
     * `good` exists so a finished import can say so in green. Reporting a clean result in the
     * same yellow used for a backlog teaches an operator to read yellow as "nothing to see".
     */
    alert: function (message, tone) {
      const glyph = tone === 'warn' ? 'warn' : tone === 'good' ? 'good' : 'bad';
      const cls = 'notice notice--' + (tone === 'warn' ? 'warn' : tone === 'good' ? 'good' : 'bad');
      $('#alert-region').html(
        '<div class="' +
          cls +
          '"><span class="notice__icon" aria-hidden="true">' +
          icon(glyph) +
          '</span>' +
          '<div><p class="notice__title">' +
          escapeHtml(message) +
          '</p></div></div>'
      );
    },

    clearAlert: function () {
      $('#alert-region').empty();
    },
  };
})(window.MaitAI, jQuery);
