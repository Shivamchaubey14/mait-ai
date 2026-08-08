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
    inventory: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
    products: 'M4 6h16M4 12h16M4 18h10M18 16v5M15.5 18.5h5',
    indents: 'M6 3h9l5 5v13H6zM14 3v6h6M9 13h7M9 17h5',
    leaderboard: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    exceptions: 'M12 3 2 20h20zM12 9v5M12 17.5v.5',
    reports: 'M6 3h9l5 5v13H6zM14 3v6h6M9 14h7M9 18h7',
    users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M2 20a7 7 0 0 1 14 0M18 8v6M15 11h6',
  };

  /* Order is the order they appear. `key` matches the page's data-page attribute. */
  const SECTIONS = [
    { key: 'dashboard', label: 'Dashboard', href: 'index.html' },
    { key: 'uploads', label: 'SAP upload', href: 'uploads.html' },
    { key: 'ai-events', label: 'AI events', href: 'ai-events.html' },
    { key: 'maits', label: 'Maits', href: 'maits.html' },
    { key: 'mpps', label: 'MPPs', href: 'mpps.html' },
    { key: 'assignments', label: 'Assignment', href: 'assignments.html' },
    { key: 'members', label: 'Members', href: 'members.html' },
    { key: 'inventory', label: 'Inventory', href: 'inventory.html' },
    { key: 'products', label: 'Products', href: 'products.html' },
    { key: 'indents', label: 'Indents', href: 'indents.html' },
    { key: 'leaderboard', label: 'Leaderboard', href: 'leaderboard.html' },
    { key: 'exceptions', label: 'Exceptions', href: 'exceptions.html', badge: true },
    { key: 'reports', label: 'Reports', href: 'reports.html' },
    { key: 'users', label: 'Users & roles', href: 'users.html' },
  ];

  function icon(key) {
    return (
      '<svg class="side__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
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
        icon(section.key),
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

    /** Insert the sidebar and mark the current section. */
    mount: function () {
      const $shell = $('.shell');
      const active = $shell.data('page');
      $shell.prepend(renderSidebar(active));
      wireAccount();
      return active;
    },

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

    /** Show a page-level failure without leaving the operator looking at a blank table. */
    alert: function (message, tone) {
      const cls = tone === 'warn' ? 'notice notice--warn' : 'notice notice--bad';
      $('#alert-region').html(
        '<div class="' +
          cls +
          '"><span class="notice__swatch" aria-hidden="true"></span>' +
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
