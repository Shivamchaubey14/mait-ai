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
     */
    rows: function ($tbody, items, rowFn, emptyMessage, columns) {
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
