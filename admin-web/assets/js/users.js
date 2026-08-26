/**
 * Users & roles (W11).
 *
 * Office accounts only. A Mait is never created here — they are activated from an existing
 * SAP Sahayak record on the Maits screen, so every field login traces back to a real person
 * on the roster rather than to whoever an admin decided to type in.
 *
 * Deactivating rather than deleting is deliberate: a deleted user takes the audit trail's
 * actor with them, and the trail is what a dispute is settled from.
 */

(function (MaitAI, $) {
  'use strict';

  const ui = MaitAI.ui;
  const LIMIT = 25;

  const state = { offset: 0, page: [], editing: null, chosen: [] };

  /* --- portal access -------------------------------------------------------------------
   * The sidebar, as a thing that can be handed out. Labels and glyphs come from the shell,
   * so a section renamed there is renamed here; the API's catalogue decides which keys are
   * real, so one the server has never heard of can never be ticked.
   */
  let catalogue = MaitAI.shell.sections.map(function (section) {
    return { key: section.key, label: section.label };
  });

  function loadCatalogue() {
    MaitAI.api.portalSections().done(function (body) {
      // Keyed by the shell's own list so the order and the glyphs stay the sidebar's.
      const known = {};
      (body.results || []).forEach(function (row) {
        known[row.key] = row.label;
      });
      catalogue = MaitAI.shell.sections
        .filter(function (section) {
          return Object.prototype.hasOwnProperty.call(known, section.key);
        })
        .map(function (section) {
          return { key: section.key, label: section.label };
        });
    });
  }

  /** One tickable section. `is-on` rather than `:has(:checked)` — the state is set in JS. */
  function accessItem(section, isOn) {
    return (
      '<label class="access__item' +
      (isOn ? ' is-on' : '') +
      '">' +
      '<input class="access__check" type="checkbox" value="' +
      ui.escapeHtml(section.key) +
      '"' +
      (isOn ? ' checked' : '') +
      ' />' +
      '<span class="access__mark" aria-hidden="true">' +
      MaitAI.shell.icon(section.key) +
      '</span>' +
      '<span class="access__name">' +
      ui.escapeHtml(section.label) +
      '</span>' +
      '<span class="access__state" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" />' +
      '</svg></span>' +
      '</label>'
    );
  }

  function accessGrid(selected) {
    const held = selected || [];
    return catalogue
      .map(function (section) {
        return accessItem(section, held.indexOf(section.key) >= 0);
      })
      .join('');
  }

  /** What is ticked in one grid, in sidebar order rather than in click order. */
  function ticked($grid) {
    const on = $grid
      .find('.access__check:checked')
      .map(function () {
        return this.value;
      })
      .get();
    return catalogue
      .map(function (section) {
        return section.key;
      })
      .filter(function (key) {
        return on.indexOf(key) >= 0;
      });
  }

  function allKeys() {
    return catalogue.map(function (section) {
      return section.key;
    });
  }

  /** `12 of 17`, or the two ends of it said in words. */
  function countLabel(chosen) {
    if (!chosen.length) {
      return 'None';
    }
    if (chosen.length === catalogue.length) {
      return 'All ' + catalogue.length;
    }
    return chosen.length + ' of ' + catalogue.length;
  }

  function scopeCell(user) {
    if (user.role === 'super_admin' || user.role === 'admin') {
      return 'All districts';
    }
    if (!user.assigned_mpp_count) {
      return '<span class="table__sub">No MPPs assigned</span>';
    }
    return ui.number(user.assigned_mpp_count) + ' MPPs';
  }

  /* Role decides what an account can reach, so it is a pill rather than one more word in a
     column of words. */
  const ROLE_PILL = { super_admin: 'pill--super', admin: 'pill--admin' };

  function rolePill(user) {
    const cls = ROLE_PILL[user.role];
    return (
      '<span class="pill' +
      (cls ? ' ' + cls : '') +
      '">' +
      ui.escapeHtml(user.role_display) +
      '</span>'
    );
  }

  function glyph(path) {
    return (
      '<svg class="btn__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="' +
      path +
      '"/></svg>'
    );
  }

  const BLOCK = 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M5.6 5.6l12.8 12.8';
  const RESTORE = 'M3 12a9 9 0 1 0 2.6-6.4L3 8M3 3v5h5';
  const PAGES = 'M3 3h7v7H3zM14 3h7v4h-7zM14 11h7v10h-7zM3 14h7v7H3z';

  /**
   * How much of the portal this account sees.
   *
   * Written out at both ends rather than left as a bare 0 or 17. "No pages" is a fact about
   * the account somebody needs to act on; "0 of 17" in a column of numbers reads as a figure
   * that has not loaded.
   */
  function pagesCell(user) {
    if (user.role !== 'admin' && user.role !== 'super_admin') {
      return '<span class="table__sub">No portal</span>';
    }
    const held = user.portal_sections || [];
    const total = user.portal_section_total || catalogue.length;
    const said = !held.length
      ? // Worth acting on rather than worth reading: this account signs in to nothing.
        ui.pill('No pages', 'bad')
      : '<span class="table__code">' +
        (held.length >= total ? 'All ' + total : held.length + ' of ' + total) +
        '</span>';

    // Only an Admin has pages to assign: a Super Admin reaches everything by role, and
    // nobody edits their own. Both read as the plain count instead.
    if (user.role !== 'admin' || user.id === meId()) {
      return said;
    }
    // The count is the control. It was a second button in the Action column, which pushed
    // an eight-column table sideways at 1280 and put Deactivate off the edge — and that
    // column is for the one thing an admin does *to* an account, not for editing a field
    // of it. Clicking the thing you want to change is also the shorter sentence.
    return (
      '<button class="pages-link" type="button" data-access="' +
      user.id +
      '" title="Change which pages they can open">' +
      said +
      glyph(PAGES) +
      '</button>'
    );
  }

  /** The signed-in account, so its own row can say why it cannot be edited. */
  function meId() {
    const stored = MaitAI.api.profile.get();
    return stored ? stored.id : null;
  }

  /**
   * The one thing an admin does to an account, in its own column.
   *
   * Named for what it will do, not for what the account currently is — "Deactivate" beside a
   * green Active pill reads as an instruction; "Active" twice reads as a broken table.
   */
  function actionCell(user) {
    return (
      '<button class="btn ' +
      (user.is_active ? 'btn--danger-outline' : 'btn--good-outline') +
      '" type="button" data-toggle="' +
      user.id +
      '" data-active="' +
      user.is_active +
      '">' +
      glyph(user.is_active ? BLOCK : RESTORE) +
      (user.is_active ? 'Deactivate' : 'Reactivate') +
      '</button>'
    );
  }

  function row(user) {
    return (
      '<tr data-user="' +
      user.id +
      '"' +
      (user.is_active ? '' : ' class="is-blocked"') +
      '>' +
      '<td>' +
      ui.identity(user.full_name, user.email) +
      '</td>' +
      '<td><span class="table__code">' +
      ui.escapeHtml(user.username) +
      '</span></td>' +
      '<td>' +
      rolePill(user) +
      '</td>' +
      '<td class="user-pages">' +
      pagesCell(user) +
      '</td>' +
      '<td>' +
      scopeCell(user) +
      '</td>' +
      '<td>' +
      (user.last_login_at
        ? ui.dateTime(user.last_login_at)
        : '<span class="table__sub">Never</span>') +
      '</td>' +
      '<td>' +
      (user.is_active ? ui.pill('Active', 'good') : ui.pill('Deactivated', 'bad')) +
      '</td>' +
      '<td class="user-action">' +
      actionCell(user) +
      '</td>' +
      '</tr>'
    );
  }

  /* --- the access editor ---------------------------------------------------------------
   * The same shape the Mait editor uses on Assignment and Maits: a head that says whose
   * record is open, the one field the panel exists for, and a save that names what it will
   * change. Written here rather than in a shared file because one screen assigns access —
   * the Mait editor was extracted only once a second screen opened it.
   */
  function initials(name) {
    const parts = String(name || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) {
      return '—';
    }
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }

  function editorMarkup() {
    return [
      '<section class="panel editor access-editor" id="access-panel" hidden ',
      'aria-label="Portal access">',

      '<div class="editor__head">',
      '<span class="editor__avatar" id="ax-initials" aria-hidden="true">—</span>',
      '<div class="editor__who">',
      '<h2 class="editor__name" id="ax-name">—</h2>',
      '<p class="editor__code" id="ax-username">—</p>',
      '</div>',
      '<span id="ax-role"></span>',
      '</div>',

      '<div class="field field--iconed field--wide">',
      '<span class="field__label">',
      '<span class="field__icon field__icon--pages" aria-hidden="true">',
      MaitAI.shell.icon('dashboard'),
      '</span>Pages in their sidebar',
      '<span class="field__count" id="ax-count">—</span></span>',

      '<div class="access__quick">',
      '<button class="btn btn--good-outline" type="button" id="ax-all">Select all</button>',
      '<button class="btn" type="button" id="ax-none">Clear</button>',
      '</div>',

      '<div class="access" id="ax-grid" role="group" aria-label="Pages"></div>',
      // Removals are named rather than counted, the same way coverage is: taking Rates away
      // is the direction that stops someone working, and "removing Rates" is a sentence an
      // operator can check before they press save.
      '<p class="field__hint" id="ax-diff">—</p>',
      '</div>',

      '<div class="form-actions">',
      '<button class="btn btn--primary" type="button" id="ax-save">',
      glyph('M5 12.5l4.5 4.5L19 7.5'),
      'Save access</button>',
      '<button class="btn" type="button" id="ax-cancel">',
      glyph('M6 6l12 12M18 6L6 18'),
      'Cancel</button>',
      '<p class="field__hint" id="ax-status">—</p>',
      '</div>',

      '</section>',
    ].join('');
  }

  /** Redraw the count and what the change costs, without redrawing the grid under a click. */
  function renderDiff() {
    const before = (state.editing && state.editing.portal_sections) || [];
    const now = state.chosen;
    const removed = catalogue.filter(function (section) {
      return before.indexOf(section.key) >= 0 && now.indexOf(section.key) < 0;
    });
    const added = catalogue.filter(function (section) {
      return before.indexOf(section.key) < 0 && now.indexOf(section.key) >= 0;
    });

    $('#ax-count').text(countLabel(now));

    const parts = [];
    if (added.length) {
      parts.push(
        'Adding ' +
          added
            .map(function (section) {
              return section.label;
            })
            .join(', ')
      );
    }
    if (removed.length) {
      parts.push(
        'Removing ' +
          removed
            .map(function (section) {
              return section.label;
            })
            .join(', ')
      );
    }
    if (!now.length) {
      parts.push('They will sign in to an empty sidebar');
    }
    $('#ax-diff')
      .text(parts.length ? parts.join(' · ') : 'Nothing changed yet.')
      .toggleClass('field__hint--warn', !now.length || removed.length > 0);
  }

  /**
   * Put one updated account back into both the table and the page behind it.
   *
   * Both, or the next thing to read `state.page` is reading what the account looked like
   * before the write — which showed as an access editor reopening with the ticks it had
   * been saved out of.
   */
  function replaceRow(user) {
    state.page = state.page.map(function (candidate) {
      return candidate.id === user.id ? user : candidate;
    });
    $('[data-user="' + user.id + '"]').replaceWith(row(user));
  }

  function openEditor(user) {
    state.editing = user;
    state.chosen = (user.portal_sections || []).slice();

    $('#ax-initials').text(initials(user.full_name));
    $('#ax-name').text(user.full_name || user.username);
    $('#ax-username').text(user.username);
    $('#ax-role').html(rolePill(user));
    $('#ax-grid').html(accessGrid(state.chosen));
    $('#ax-status').text('—');
    renderDiff();

    $('#access-panel').prop('hidden', false);
    // The panel is above the table and the row clicked may be well down it.
    $('#access-panel')[0].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function closeEditor() {
    state.editing = null;
    $('#access-panel').prop('hidden', true);
  }

  function saveEditor() {
    if (!state.editing) {
      return;
    }
    const id = state.editing.id;
    $('#ax-save').prop('disabled', true);
    $('#ax-status').text('Saving…');

    MaitAI.api
      .updateUser(id, { portal_sections: state.chosen })
      .done(function (user) {
        closeEditor();
        if (user && user.id) {
          replaceRow(user);
        } else {
          load();
        }
      })
      .fail(function (problem) {
        $('#ax-status').text('');
        MaitAI.shell.alert(MaitAI.api.problemToLines(problem).join(' · '));
      })
      .always(function () {
        $('#ax-save').prop('disabled', false);
      });
  }

  /**
   * How the page in front of the operator splits, in the panel head.
   *
   * Of this page, not of the network: the list is paged, and a head that counted every account
   * in the database would disagree with the rows under it the moment there were two pages.
   */
  function countActive() {
    const total = $('#rows tr[data-user]').length;
    const off = $('#rows tr.is-blocked').length;
    $('#active-count').text(
      total ? total - off + ' active' + (off ? ' · ' + off + ' deactivated' : '') : ''
    );
  }

  /**
   * Searched on the server, not in the browser.
   *
   * The account list is paged, so filtering what happened to arrive would hide matches on
   * every page but the one being looked at.
   */
  function query() {
    const params = { limit: LIMIT, offset: state.offset };
    const search = ($('#search').val() || '').trim();
    const role = $('#filter-role').val();
    if (search) {
      params.search = search;
    }
    if (role) {
      params.role = role;
    }
    return params;
  }

  function load() {
    MaitAI.shell.clearAlert();
    MaitAI.api
      .users(query())
      .done(function (page) {
        // Kept so the access editor can open from a row without a second fetch of an account
        // the screen is already showing.
        state.page = page.results || [];
        $('#user-count').text(ui.number(page.count));
        ui.rows(
          $('#rows'),
          page.results,
          row,
          ($('#search').val() || '').trim() || $('#filter-role').val()
            ? 'No account matches those filters.'
            : 'No portal accounts yet.',
          8
        );
        countActive();
        ui.pager(
          $('#pager'),
          { count: page.count, limit: LIMIT, offset: state.offset },
          function (offset) {
            state.offset = offset;
            load();
          }
        );
      })
      .fail(function (problem) {
        MaitAI.shell.alert(problem.detail);
        ui.rows($('#rows'), [], row, 'Could not load accounts.', 8);
        countActive();
      });
  }

  $(function () {
    if (!MaitAI.shell.requireSession()) {
      return;
    }
    MaitAI.shell.mount();
    loadCatalogue();
    $('#access-editor').html(editorMarkup());
    $('#new-access').html(accessGrid(allKeys()));
    $('#new-access-count').text(countLabel(allKeys()));
    load();

    // Debounced: every keystroke is a round trip otherwise, and the list is paged.
    let debounce = null;
    $('#search').on('input', function () {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(function () {
        state.offset = 0;
        load();
      }, 350);
    });

    $('#filter-role').on('change', function () {
      state.offset = 0;
      load();
    });

    $('#create').on('click', function () {
      $('#create-panel').prop('hidden', false);
      $('#new-username').trigger('focus');
    });

    /* --- ticking a section ---------------------------------------------------------------
       One handler for both grids. The label is the control, so the click already toggles the
       checkbox; all this does is move the card's own state to match and recount. */
    $(document).on('change', '.access__check', function () {
      const $item = $(this).closest('.access__item');
      $item.toggleClass('is-on', this.checked);

      const $grid = $item.closest('.access');
      if ($grid.attr('id') === 'ax-grid') {
        state.chosen = ticked($grid);
        renderDiff();
      } else {
        $('#new-access-count').text(countLabel(ticked($grid)));
      }
    });

    function setAll($grid, on) {
      $grid.find('.access__check').prop('checked', on);
      $grid.find('.access__item').toggleClass('is-on', on);
    }

    $('#new-access-all').on('click', function () {
      setAll($('#new-access'), true);
      $('#new-access-count').text(countLabel(allKeys()));
    });

    $('#new-access-none').on('click', function () {
      setAll($('#new-access'), false);
      $('#new-access-count').text(countLabel([]));
    });

    // A Super Admin reaches every page by role, so there is nothing on this form to decide
    // for one. Hidden rather than disabled: seventeen greyed cards suggest a choice exists.
    $('#new-role').on('change', function () {
      $('#new-access-field').prop('hidden', $(this).val() === 'super_admin');
    });

    /* --- the row's access editor ---------------------------------------------------------- */
    $('#rows').on('click', '[data-access]', function () {
      const id = String($(this).data('access'));
      const user = state.page.filter(function (candidate) {
        return String(candidate.id) === id;
      })[0];
      if (user) {
        openEditor(user);
      }
    });

    $('#ax-all').on('click', function () {
      setAll($('#ax-grid'), true);
      state.chosen = allKeys();
      renderDiff();
    });

    $('#ax-none').on('click', function () {
      setAll($('#ax-grid'), false);
      state.chosen = [];
      renderDiff();
    });

    $('#ax-cancel').on('click', closeEditor);
    $('#ax-save').on('click', saveEditor);

    $('#create-cancel').on('click', function () {
      $('#create-panel').prop('hidden', true);
    });

    $('#create-form').on('submit', function (event) {
      event.preventDefault();
      MaitAI.shell.clearAlert();

      MaitAI.api
        .createUser({
          username: $('#new-username').val().trim(),
          full_name: $('#new-full-name').val().trim(),
          email: $('#new-email').val().trim(),
          role: $('#new-role').val(),
          password: $('#new-password').val(),
          portal_sections:
            $('#new-role').val() === 'super_admin' ? undefined : ticked($('#new-access')),
        })
        .done(function () {
          $('#create-form')[0].reset();
          $('#new-access').html(accessGrid(allKeys()));
          $('#new-access-count').text(countLabel(allKeys()));
          $('#new-access-field').prop('hidden', false);
          $('#create-panel').prop('hidden', true);
          state.offset = 0;
          load();
        })
        .fail(function (problem) {
          // Field-level messages, so the operator knows which box to fix rather than being
          // told the whole form is wrong.
          MaitAI.shell.alert(MaitAI.api.problemToLines(problem).join(' · '));
        });
    });

    /**
     * Flip one account, and repaint only its row.
     *
     * Reloading the whole page of accounts to change one word threw away the operator's place
     * in the list and made a one-field write look like a slow screen. The response is the
     * updated user, so the row it came from is rewritten from it — status pill, row tint and
     * the button's own label all move together.
     */
    $('#rows').on('click', '[data-toggle]', function () {
      const $button = $(this);
      const id = $button.data('toggle');
      const nowActive = String($button.data('active')) !== 'true';
      const label = $button.text().trim();

      $button.prop('disabled', true).addClass('is-working');

      MaitAI.api
        .updateUser(id, { is_active: nowActive })
        .done(function (user) {
          // A response without the user is not enough to rebuild the row — name, username and
          // scope all live in it — so that falls back to a reload rather than to a stub.
          if (!user || !user.id) {
            load();
            return;
          }
          replaceRow(user);
          countActive();
        })
        .fail(function (problem) {
          $button.prop('disabled', false).removeClass('is-working').text(label);
          MaitAI.shell.alert(problem.detail);
        });
    });
  });
})(window.MaitAI, jQuery);
