/**
 * The two controls the browser draws itself, rebuilt as real elements (controls.css).
 *
 * A `<select>`'s option list and a date input's calendar are OS widgets rendered outside the
 * page. `appearance: none` styles the closed box and reaches none of what drops out of it, so
 * every filter bar in the portal opened a square grey Windows menu on top of a rounded page.
 *
 * The native control is kept, hidden, and stays the source of truth. Everything already written
 * against it keeps working untouched — `$('#filter-status').val()`, `.trigger('change')`, a
 * form's own reset — because the thing being read and reset is still the `<select>`. This
 * replaces what is seen and clicked, nothing else.
 *
 * Options added after the page loads (the MPP lists on Reports and AI events are fetched) are
 * picked up by a MutationObserver, so no screen has to tell this file it has changed.
 */

window.MaitAI = window.MaitAI || {};

(function (MaitAI, $) {
  'use strict';

  const CHEVRON = 'M6 9l6 6 6-6';
  const TICK = 'M5 12.5l4.5 4.5L19 7.5';
  const LEFT = 'M15 6l-6 6 6 6';
  const RIGHT = 'M9 6l6 6-6 6';
  const CALENDAR = 'M4 5h16v16H4zM4 9h16M8 3v4M16 3v4';

  const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  function svg(path, className) {
    return (
      '<svg class="' +
      className +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' +
      path +
      '"/></svg>'
    );
  }

  function escapeHtml(value) {
    return $('<div></div>')
      .text(value === null || value === undefined ? '' : value)
      .html();
  }

  /* Only one panel open at a time. Two open menus is two things claiming the same click. */
  function closeAll(except) {
    $('.pick').each(function () {
      if (this !== except) {
        $(this).find('.pick__panel').prop('hidden', true);
        $(this).find('.pick__button').attr('aria-expanded', 'false');
      }
    });
  }

  /**
   * Keep a panel on screen.
   *
   * A filter bar runs to the right edge of the content column, and a panel anchored left from
   * a control sitting there opens off the page.
   */
  function place($pick) {
    const $panel = $pick.find('.pick__panel');
    $panel.removeClass('pick__panel--right');
    const right = $panel[0].getBoundingClientRect().right;
    if (right > window.innerWidth - 8) {
      $panel.addClass('pick__panel--right');
    }
  }

  function open($pick) {
    closeAll($pick[0]);
    $pick.find('.pick__panel').prop('hidden', false);
    $pick.find('.pick__button').attr('aria-expanded', 'true');
    place($pick);
  }

  function close($pick, refocus) {
    $pick.find('.pick__panel').prop('hidden', true);
    $pick.find('.pick__button').attr('aria-expanded', 'false');
    if (refocus) {
      $pick.find('.pick__button').trigger('focus');
    }
  }

  function isOpen($pick) {
    return !$pick.find('.pick__panel').prop('hidden');
  }

  // ------------------------------------------------------------------------------------
  // Select
  // ------------------------------------------------------------------------------------

  /** Redraw the options from the native select, and the button from its current value. */
  function syncSelect($pick) {
    const select = $pick.find('select')[0];
    const current = select.value;

    const options = Array.prototype.map
      .call(select.options, function (option) {
        const selected = option.value === current;
        return (
          '<button class="pick__option" type="button" role="option" aria-selected="' +
          selected +
          '" data-value="' +
          escapeHtml(option.value) +
          '">' +
          escapeHtml(option.text) +
          svg(TICK, 'pick__tick') +
          '</button>'
        );
      })
      .join('');

    $pick.find('.pick__menu').html(options);

    const chosen = select.options[select.selectedIndex];
    $pick.find('.pick__value').text(chosen ? chosen.text : '');
  }

  function buildSelect(select) {
    const $select = $(select);
    if ($select.parent().hasClass('pick')) {
      return;
    }

    const block = $select.hasClass('field__control');
    const $pick = $('<div class="pick' + (block ? '' : ' pick--auto') + '"></div>');

    $select
      .wrap($pick)
      .addClass('visually-hidden')
      .attr({ tabindex: -1, 'aria-hidden': 'true' })
      .before(
        '<button class="input pick__button" type="button" aria-haspopup="listbox" ' +
          'aria-expanded="false"><span class="pick__value"></span>' +
          svg(CHEVRON, 'pick__chevron') +
          '</button>'
      )
      .before(
        '<div class="pick__panel" hidden><div class="pick__menu" role="listbox"></div></div>'
      );

    const $wrap = $select.parent();
    // The label still points at the native select, so clicking it must reach the button that
    // replaced it — otherwise the label focuses something nobody can see.
    const id = $select.attr('id');
    if (id) {
      $wrap.find('.pick__button').attr('aria-labelledby', id + '-label');
      $('label[for="' + id + '"]').attr('id', id + '-label');
    }

    syncSelect($wrap);

    // Options usually arrive after this runs — the MPP lists are fetched. Watching the element
    // means no screen has to announce that it has filled its own select in.
    if (window.MutationObserver) {
      new window.MutationObserver(function () {
        syncSelect($wrap);
      }).observe(select, { childList: true });
    }

    // A screen that sets the value itself, or a form being reset, still has to show through.
    $select.on('change.pick', function () {
      syncSelect($wrap);
    });
  }

  // ------------------------------------------------------------------------------------
  // Date
  // ------------------------------------------------------------------------------------

  function iso(date) {
    const pad = function (n) {
      return (n < 10 ? '0' : '') + n;
    };
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  /** dd-mm-yyyy, which is what the placeholder promised and what an Indian office writes. */
  function readable(value) {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    return parts ? parts[3] + '-' + parts[2] + '-' + parts[1] : '';
  }

  function monthGrid($pick, year, month) {
    const selected = $pick.find('input').val();
    const todayIso = iso(new Date());

    // Monday-first: the week an Indian dairy office plans in starts on Monday, and the SAP
    // exports it is reconciled against do too.
    const first = new Date(year, month, 1);
    const lead = (first.getDay() + 6) % 7;
    const start = new Date(year, month, 1 - lead);

    let cells = DOW.map(function (day) {
      return '<div class="cal__dow">' + day + '</div>';
    }).join('');

    for (let i = 0; i < 42; i += 1) {
      const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const value = iso(day);
      const outside = day.getMonth() !== month;
      cells +=
        '<button class="cal__day' +
        (outside ? ' cal__day--outside' : '') +
        (value === todayIso ? ' cal__day--today' : '') +
        (value === selected ? ' is-selected' : '') +
        '" type="button" data-date="' +
        value +
        '"' +
        (value === selected ? ' aria-current="date"' : '') +
        '>' +
        day.getDate() +
        '</button>';
    }

    $pick.find('.cal__title').text(MONTHS[month] + ' ' + year);
    $pick.find('.cal__grid').html(cells);
    $pick.data('view', { year: year, month: month });
  }

  /** Open on the chosen month, or on this one when nothing is chosen yet. */
  function viewFor($pick) {
    const value = $pick.find('input').val();
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    const date = parts ? new Date(Number(parts[1]), Number(parts[2]) - 1, 1) : new Date();
    return { year: date.getFullYear(), month: date.getMonth() };
  }

  function syncDate($pick) {
    const value = $pick.find('input').val();
    const text = readable(value);
    $pick
      .find('.pick__value')
      .text(text || 'dd-mm-yyyy')
      .toggleClass('pick__value--empty', !text);
  }

  function buildDate(input) {
    const $input = $(input);
    if ($input.parent().hasClass('pick')) {
      return;
    }

    // Held as text so the value survives with the same YYYY-MM-DD shape every screen already
    // sends to the API, without the browser attaching its own calendar to it again.
    $input
      .attr('type', 'text')
      .wrap('<div class="pick pick--date"></div>')
      .addClass('visually-hidden')
      .attr({ tabindex: -1, 'aria-hidden': 'true' })
      .before(
        '<button class="input pick__button" type="button" aria-haspopup="dialog" ' +
          'aria-expanded="false">' +
          svg(CALENDAR, 'pick__lead') +
          '<span class="pick__value"></span>' +
          svg(CHEVRON, 'pick__chevron') +
          '</button>'
      )
      .before(
        '<div class="pick__panel" hidden><div class="cal" role="dialog" aria-label="Choose a date">' +
          '<div class="cal__head">' +
          '<button class="cal__step" type="button" data-step="-1" aria-label="Previous month">' +
          svg(LEFT, '') +
          '</button>' +
          '<span class="cal__title"></span>' +
          '<button class="cal__step" type="button" data-step="1" aria-label="Next month">' +
          svg(RIGHT, '') +
          '</button></div>' +
          '<div class="cal__grid"></div>' +
          '<div class="cal__foot">' +
          '<button class="cal__action" type="button" data-today>Today</button>' +
          '<button class="cal__action cal__action--clear" type="button" data-clear>Clear</button>' +
          '</div></div></div>'
      );

    const $wrap = $input.parent();
    const id = $input.attr('id');
    if (id) {
      $wrap.find('.pick__button').attr('aria-labelledby', id + '-label');
      $('label[for="' + id + '"]').attr('id', id + '-label');
    }

    syncDate($wrap);
    $input.on('change.pick', function () {
      syncDate($wrap);
    });
  }

  // ------------------------------------------------------------------------------------
  // Wiring
  // ------------------------------------------------------------------------------------

  /**
   * Write the choice to the native control, then repaint the visible half.
   *
   * Repainted here rather than left to the `change` handler. That handler exists for a screen
   * that sets the value itself, and relying on it for our own clicks made the visible half of
   * the date field depend on event plumbing it did not need — a date was written to the input
   * and the button went on reading "dd-mm-yyyy".
   */
  function commit($pick, value) {
    const $native = $pick.find('select, input').first();
    $native.val(value).trigger('change');
    if ($pick.hasClass('pick--date')) {
      syncDate($pick);
    } else {
      syncSelect($pick);
    }
    close($pick, true);
  }

  function wire() {
    $(document)
      .on('click.pick', '.pick__button', function (event) {
        event.preventDefault();
        const $pick = $(this).closest('.pick');
        if (isOpen($pick)) {
          close($pick);
          return;
        }
        if ($pick.hasClass('pick--date')) {
          const view = viewFor($pick);
          monthGrid($pick, view.year, view.month);
        }
        open($pick);
      })

      .on('click.pick', '.pick__option', function () {
        commit($(this).closest('.pick'), $(this).data('value'));
      })

      .on('click.pick', '.cal__day', function () {
        commit($(this).closest('.pick'), $(this).data('date'));
      })

      .on('click.pick', '.cal__step', function () {
        const $pick = $(this).closest('.pick');
        const view = $pick.data('view');
        monthGrid($pick, view.year, view.month + Number($(this).data('step')));
      })

      .on('click.pick', '[data-today]', function () {
        commit($(this).closest('.pick'), iso(new Date()));
      })

      .on('click.pick', '[data-clear]', function () {
        commit($(this).closest('.pick'), '');
      })

      // Anywhere else on the page closes whatever is open, which is what a menu is expected to
      // do and the reason this is delegated to the document rather than bound per control.
      .on('mousedown.pick', function (event) {
        if (!$(event.target).closest('.pick').length) {
          closeAll(null);
        }
      })

      .on('keydown.pick', '.pick', function (event) {
        const $pick = $(this);
        const key = event.key;

        if (key === 'Escape' && isOpen($pick)) {
          event.preventDefault();
          close($pick, true);
          return;
        }

        if (!isOpen($pick)) {
          if (key === 'Enter' || key === ' ' || key === 'ArrowDown') {
            event.preventDefault();
            $pick.find('.pick__button').trigger('click');
          }
          return;
        }

        if ($pick.hasClass('pick--date')) {
          return;
        }

        const $options = $pick.find('.pick__option');
        const current = $options.filter('.is-active').index();
        const at = current >= 0 ? current : $options.filter('[aria-selected="true"]').index();

        if (key === 'ArrowDown' || key === 'ArrowUp') {
          event.preventDefault();
          const next = Math.min(
            $options.length - 1,
            Math.max(0, at + (key === 'ArrowDown' ? 1 : -1))
          );
          $options.removeClass('is-active').eq(next).addClass('is-active');
          $options[next].scrollIntoView({ block: 'nearest' });
        } else if (key === 'Enter') {
          event.preventDefault();
          commit($pick, $options.eq(Math.max(0, at)).data('value'));
        }
      });

    // A reset puts the native controls back and says nothing about it, so the visible halves
    // are re-read once the browser has finished.
    $(document).on('reset.pick', 'form', function () {
      window.setTimeout(function () {
        $('.pick').each(function () {
          const $pick = $(this);
          if ($pick.hasClass('pick--date')) {
            syncDate($pick);
          } else if ($pick.find('select').length) {
            syncSelect($pick);
          }
        });
      }, 0);
    });
  }

  let wired = false;

  MaitAI.controls = {
    /**
     * Upgrade every native select and date field on the page.
     *
     * Safe to call again: an upgraded control is skipped, so a screen that renders more of its
     * own can simply call this after it has.
     */
    mount: function (root) {
      const $root = root ? $(root) : $(document);
      $root.find('select').each(function () {
        buildSelect(this);
      });
      $root.find('input[type="date"]').each(function () {
        buildDate(this);
      });
      if (!wired) {
        wire();
        wired = true;
      }
    },
  };
})(window.MaitAI, jQuery);
