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

  /* Order is the order they appear. `key` matches the page's data-page attribute. */
  const SECTIONS = [
    { key: 'dashboard', label: 'Dashboard', href: 'index.html' },
    { key: 'uploads', label: 'SAP upload', href: 'uploads.html' },
    { key: 'ai-events', label: 'AI events', href: 'ai-events.html' },
    { key: 'maits', label: 'Maits', href: 'maits.html' },
    { key: 'mpps', label: 'MPPs', href: 'mpps.html' },
    { key: 'members', label: 'Members', href: 'members.html' },
    { key: 'inventory', label: 'Inventory', href: 'inventory.html' },
    { key: 'indents', label: 'Indents', href: 'indents.html' },
    { key: 'leaderboard', label: 'Leaderboard', href: 'leaderboard.html' },
    { key: 'exceptions', label: 'Exceptions', href: 'exceptions.html', badge: true },
    { key: 'reports', label: 'Reports', href: 'reports.html' },
    { key: 'users', label: 'Users & roles', href: 'users.html' },
  ];

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
        '<span class="side__dot" aria-hidden="true"></span>',
        escapeHtml(section.label),
        section.badge ? '<span class="side__badge" id="exception-badge" hidden>0</span>' : '',
        '</a>',
      ].join('');
    }).join('');

    return [
      '<aside class="side">',
      '<div class="side__mark">',
      '<span class="side__mark-name">MAIT AI</span>',
      '<span class="side__mark-sub">ADMIN</span>',
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
