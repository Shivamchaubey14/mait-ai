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

  const state = {
    offset: 0,
    page: [],
    editing: null,
    chosen: [],
    detailing: null,
    crediting: null,
  };

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

  /**
   * How much of the network this account sees.
   *
   * It said "All districts" for every office account, which stopped being true the day zones
   * arrived — and it was the kind of untrue that nobody reports, because it is what the column
   * always said. An Admin now shows the zones it holds, or the whole network when it holds
   * none, which is still most accounts.
   *
   * A Super Admin is never scoped and says so rather than showing an empty list: they are the
   * accounts that hand zones out.
   */
  function scopeCell(user) {
    if (user.role === 'super_admin') {
      return '<span class="table__sub">Whole network</span>';
    }
    if (SECTION_SCOPED[user.role]) {
      const names = user.zone_names || [];
      const said = names.length
        ? names
            .map(function (name) {
              return '<span class="chip chip--static">' + ui.escapeHtml(name) + '</span>';
            })
            .join(' ') + appLine(user)
        : '<span class="table__sub">Whole network</span>';
      // The cell is the control, the same bargain the Pages column makes: clicking the thing
      // you want to change is shorter than finding a second button for it, and the Action
      // column is for what an admin does *to* an account rather than to a field of it.
      if (user.id === meId()) {
        return said;
      }
      return (
        '<button class="pages-link" type="button" data-zones="' +
        user.id +
        '" title="Change which zones they see">' +
        said +
        glyph(ZONES) +
        '</button>'
      );
    }
    if (!user.assigned_mpp_count) {
      return '<span class="table__sub">No MPPs assigned</span>';
    }
    return ui.number(user.assigned_mpp_count) + ' MPPs';
  }

  /**
   * Whether this zone-scoped account can also sign in on a handset.
   *
   * A zone is what makes somebody a zonal manager, and a zonal manager is the one office
   * account that works away from a desk — so the moment a zone is ticked, the number becomes
   * an operational fact rather than a contact detail. Shown under the zone chips because
   * that is where the decision was made; missing, it says so, since an account waiting on a
   * number looks identical to one that never needed one.
   */
  function appLine(user) {
    if (user.mobile_no) {
      return '<span class="table__sub">App · ' + ui.escapeHtml(user.mobile_no) + '</span>';
    }
    return '<span class="table__sub table__sub--warn">No number — no app</span>';
  }

  /* Role decides what an account can reach, so it is a pill rather than one more word in a
     column of words. */
  const ROLE_PILL = {
    super_admin: 'pill--super',
    admin: 'pill--admin',
    normal_user: 'pill--normal',
  };

  // The office roles whose access is a list of pages to assign — as opposed to a Super Admin,
  // who reaches everything by role, and a Mait, who has no portal. An Admin and a Normal User
  // are the same account bar one capability (deleting AI events), so both carry a pages list.
  const SECTION_SCOPED = { admin: true, normal_user: true };

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
  const ZONES = 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15';
  const PERSON = 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21a8 8 0 0 1 16 0';
  const MAIL = 'M3 6h18v12H3zM3 7l9 6 9-6';
  const MOBILE = 'M7 2h10v20H7zM11 18h2';
  const KEY = 'M6 10V7a6 6 0 1 1 12 0v3M5 10h14v11H5z';

  /**
   * How much of the portal this account sees.
   *
   * Written out at both ends rather than left as a bare 0 or 17. "No pages" is a fact about
   * the account somebody needs to act on; "0 of 17" in a column of numbers reads as a figure
   * that has not loaded.
   */
  function pagesCell(user) {
    if (!SECTION_SCOPED[user.role] && user.role !== 'super_admin') {
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

    // Only a section-scoped account (Admin or Normal User) has pages to assign: a Super Admin
    // reaches everything by role, and nobody edits their own. Both read as the plain count.
    if (!SECTION_SCOPED[user.role] || user.id === meId()) {
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

  /**
   * The tick that puts an account in a bulk action.
   *
   * Not on your own row. Deactivating yourself is the one change on this screen that cannot be
   * undone from this screen — the account that could put it back is the one just switched off —
   * and a bulk action is precisely where it would happen without being noticed, as the 41st tick
   * in a Select all. The row action beside it still offers it for a single deliberate account.
   */
  function pickCell(user) {
    if (user.id === meId()) {
      return '<td class="col-pick"><span class="table__sub" title="Your own account">—</span></td>';
    }
    return (
      '<td class="col-pick">' +
      '<input class="pick" type="checkbox" value="' +
      user.id +
      '" aria-label="Select ' +
      ui.escapeHtml(user.full_name || user.username) +
      '" />' +
      '</td>'
    );
  }

  /**
   * The name, and the way to correct it.
   *
   * Not a button in the Action column, which is where every other table in this portal puts
   * its row action. This table is eight columns wide and already overruns its wrapper by
   * ~150px at 1280 — the Action column is off the right edge before anything is added to it,
   * and a second button there measured 89px more of a thing nobody can see. The name is where
   * somebody looks when the name is wrong, and `.table__name--link` is the treatment this
   * portal already uses for a name that opens a record — its underline on hover is the one
   * signal a row of plain text needs. No glyph beside it: a 13px pencil and its gap measured
   * 17px onto a column that is already past its wrapper, which is the thing being avoided.
   */
  function nameCell(user) {
    return (
      '<button class="table__name table__name--link user-name" type="button" data-detail="' +
      user.id +
      '" title="Edit this account">' +
      ui.escapeHtml(user.full_name || user.username) +
      '</button>' +
      (user.email ? '<span class="table__sub">' + ui.escapeHtml(user.email) + '</span>' : '')
    );
  }

  /**
   * The sign-in name, and the way to change it (and the password behind it).
   *
   * The same bargain the Pages and Scope cells make: the cell is the control, because the
   * username is where somebody looks when the sign-in is wrong, and clicking the thing you want
   * to change is shorter than hunting for a button in the Action column — which is already past
   * the right edge of its wrapper. Only an Admin reaches this screen at all, so the "admin only"
   * rule is the screen, not the row.
   */
  function usernameCell(user) {
    return (
      '<button class="pages-link username-link" type="button" data-credentials="' +
      user.id +
      '" title="Change username or password">' +
      '<span class="table__code">' +
      ui.escapeHtml(user.username) +
      '</span>' +
      glyph(KEY) +
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
      pickCell(user) +
      '<td>' +
      nameCell(user) +
      '</td>' +
      '<td>' +
      usernameCell(user) +
      '</td>' +
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
      // A sign-in bypass is never hidden: when the fixed code is on for this account, the row
      // says so, in yolk, so it is read at a glance and turned off once the training is over.
      (user.fixed_otp_enabled ? ' ' + ui.pill('Code 123456', 'warn') : '') +
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
          // Nine columns since the tick column arrived — an empty state that spans eight of
          // them leaves a stray cell at the end of the row.
          9
        );
        countActive();
        // The rows are new, so nothing is ticked any more and the bar has to say so.
        renderBulk();
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

  /* --- bulk activate and deactivate -----------------------------------------------------------
   *
   * There is no bulk endpoint, and `docs/API_CONTRACT.md` is frozen — so this fans out the same
   * `PATCH /admin/users/{id}/` the single row button uses. That is not a workaround it is
   * apologising for: each account goes through the same serializer, the same validation and the
   * same `record_audit` call, so twenty accounts switched off leave twenty audit entries naming
   * who did it. A bulk endpoint writing one entry for twenty accounts would be the regression.
   *
   * Four at a time. A burst of forty parallel requests is a self-inflicted load test against a
   * server that is also serving the rest of the office, and the throttles would start refusing
   * partway through — which reads to the operator as "some of them randomly failed".
   */
  const BULK_PARALLEL = 4;

  function picked() {
    return $('#rows .pick:checked')
      .map(function () {
        return Number(this.value);
      })
      .get();
  }

  function userById(id) {
    return state.page.filter(function (candidate) {
      return candidate.id === id;
    })[0];
  }

  /**
   * Those of the ticked accounts an action would actually change.
   *
   * By field and target value, so the one helper serves both the on/off of sign-in
   * (`is_active`) and of the fixed login code (`fixed_otp_enabled`): an account already in the
   * target state is left out, so no button offers to do nothing.
   */
  function wouldChange(ids, field, value) {
    return ids.filter(function (id) {
      const user = userById(id);
      return user && !!user[field] !== value;
    });
  }

  function renderBulk() {
    const ids = picked();
    const $bar = $('#bulk');

    if (!ids.length) {
      $bar.prop('hidden', true);
      $('#bulk-status').text('');
      syncPickAll();
      return;
    }

    const toActivate = wouldChange(ids, 'is_active', true).length;
    const toDeactivate = wouldChange(ids, 'is_active', false).length;
    const toFixedOn = wouldChange(ids, 'fixed_otp_enabled', true).length;
    const toFixedOff = wouldChange(ids, 'fixed_otp_enabled', false).length;

    $('#bulk-count').text(ids.length + (ids.length === 1 ? ' account' : ' accounts') + ' selected');

    // Counted, and hidden when the count is nought. "Activate 0" is a button that does nothing
    // dressed as one that does something; a selection of live accounts simply has no Activate.
    $('#bulk-activate')
      .prop('hidden', !toActivate)
      .text('Activate ' + toActivate);
    $('#bulk-deactivate')
      .prop('hidden', !toDeactivate)
      .text('Deactivate ' + toDeactivate);
    $('#bulk-fixed-on')
      .prop('hidden', !toFixedOn)
      .text('Fixed code on · ' + toFixedOn);
    $('#bulk-fixed-off')
      .prop('hidden', !toFixedOff)
      .text('Fixed code off · ' + toFixedOff);

    $bar.prop('hidden', false);
    syncPickAll();
  }

  /** The header tick reflects the rows: all, none, or the in-between state. */
  function syncPickAll() {
    const $boxes = $('#rows .pick');
    const $on = $('#rows .pick:checked');
    const all = $boxes.length > 0 && $on.length === $boxes.length;
    $('#pick-all')
      .prop('checked', all)
      .prop('indeterminate', $on.length > 0 && !all);
  }

  function setBulkBusy(busy) {
    $(
      '#bulk-activate, #bulk-deactivate, #bulk-fixed-on, #bulk-fixed-off, #bulk-clear, #pick-all'
    ).prop('disabled', busy);
    $('#rows .pick').prop('disabled', busy);
  }

  /**
   * Walk the list, `BULK_PARALLEL` in flight, and report what happened to all of it.
   *
   * A refusal does not stop the rest: the accounts that can change should, and the ones that
   * could not are named at the end. Stopping at the first failure would leave the operator with
   * a half-done job and no way to tell how far it got.
   */
  function runBulk(ids, field, value, verbing, verbed) {
    const done = [];
    const failed = [];
    let next = 0;

    setBulkBusy(true);
    $('#bulk-status').text(verbing + ' 0 of ' + ids.length + '…');

    function step() {
      if (next >= ids.length) {
        return $.Deferred().resolve().promise();
      }
      const id = ids[next++];
      return MaitAI.api
        .updateUser(id, { [field]: value })
        .done(function (user) {
          done.push(id);
          if (user && user.id) {
            replaceRow(user);
          }
        })
        .fail(function (problem) {
          const user = userById(id);
          failed.push({
            who: (user && (user.full_name || user.username)) || '#' + id,
            why: MaitAI.api.problemToLines(problem)[0],
          });
        })
        .always(function () {
          $('#bulk-status').text(
            verbing + ' ' + (done.length + failed.length) + ' of ' + ids.length + '…'
          );
        })
        .then(step, step);
    }

    const lanes = [];
    for (let lane = 0; lane < Math.min(BULK_PARALLEL, ids.length); lane += 1) {
      lanes.push(step());
    }

    $.when.apply($, lanes).always(function () {
      setBulkBusy(false);
      countActive();
      renderBulk();

      if (!failed.length) {
        $('#bulk-status').text(
          done.length + (done.length === 1 ? ' account ' : ' accounts ') + verbed + '.'
        );
        return;
      }
      // Named, not counted. "3 failed" sends somebody back through forty rows looking for them.
      $('#bulk-status').text(
        done.length +
          ' changed · ' +
          failed.length +
          ' refused: ' +
          failed
            .map(function (entry) {
              return entry.who;
            })
            .join(', ')
      );
      MaitAI.shell.alert(
        failed
          .map(function (entry) {
            return entry.who + ' — ' + entry.why;
          })
          .join(' · ')
      );
    });
  }

  /* --- the details editor -------------------------------------------------------------------
   * Who the person is, as opposed to what they can reach.
   *
   * `full_name` was settable when the account was created and nowhere afterwards, so a name
   * typed wrong stayed wrong: the portal offered no field, and the custom `User` model is not
   * registered in Django's admin either, which left a shell command as the only correction.
   * The API has always taken it — `AdminUserUpdateSerializer` carries `full_name`, `email` and
   * `mobile_no` — so this is a panel over an endpoint that was already there.
   *
   * A third panel rather than a field on one of the other two, for the reason the zone editor
   * gives below: these are decided by different people on different days, and sharing a save
   * makes one an accident of the other. Correcting a spelling must not also be the moment
   * somebody's zones or pages move.
   */
  function detailEditorMarkup() {
    return [
      '<section class="panel editor detail-editor" id="detail-panel" hidden ',
      'aria-label="Account details">',

      '<div class="editor__head">',
      '<span class="editor__avatar" id="dx-initials" aria-hidden="true">—</span>',
      '<div class="editor__who">',
      '<h2 class="editor__name" id="dx-name">—</h2>',
      '<p class="editor__code" id="dx-username">—</p>',
      '</div>',
      '<span id="dx-role"></span>',
      '</div>',

      '<div class="form-grid">',

      '<div class="field field--iconed">',
      '<label class="field__label" for="dx-full-name">',
      '<span class="field__icon" aria-hidden="true">',
      glyph(PERSON),
      '</span>Full name</label>',
      '<input class="input field__control" id="dx-full-name" type="text" maxlength="150" ',
      'autocomplete="off" />',
      '<p class="field__hint">What every screen in the portal calls them.</p>',
      '</div>',

      '<div class="field field--iconed">',
      '<label class="field__label" for="dx-email">',
      '<span class="field__icon" aria-hidden="true">',
      glyph(MAIL),
      '</span>Email</label>',
      '<input class="input field__control" id="dx-email" type="email" autocomplete="off" />',
      '<p class="field__hint">Optional. Shown under their name in the table.</p>',
      '</div>',

      '<div class="field field--iconed">',
      '<label class="field__label" for="dx-mobile">',
      '<span class="field__icon" aria-hidden="true">',
      glyph(MOBILE),
      '</span>Mobile number</label>',
      '<input class="input field__control" id="dx-mobile" type="tel" inputmode="numeric" ',
      'maxlength="10" autocomplete="off" placeholder="9876543210" />',
      // The same number the Zones screen edits for a manager. Said out loud, so an operator
      // who meets it in two places knows it is one field and not two.
      '<p class="field__hint" id="dx-mobile-hint">—</p>',
      '</div>',

      '</div>',

      // Role, shown only for the two interchangeable office roles (Admin, Normal User) — see
      // openDetailEditor. The difference between them is one line: a Normal User cannot delete
      // AI events. Which pages they open is unchanged by this and stays on the Pages control.
      // Super Admin and Mait are not switchable here (promotion and the field/office divide are
      // deliberately not a casual edit), so for them this field is hidden and the pill stands.
      '<div class="field field--iconed" id="dx-role-field" hidden>',
      '<label class="field__label" for="dx-role-select">',
      '<span class="field__icon field__icon--role" aria-hidden="true">',
      glyph('M12 3l8 4v5c0 5-3.4 8.3-8 9.5C7.4 20.3 4 17 4 12V7z'),
      '</span>Role</label>',
      '<select class="select field__control" id="dx-role-select">',
      '<option value="admin">Admin</option>',
      '<option value="normal_user">Normal User</option>',
      '</select>',
      '<p class="field__hint">A Normal User sees and works the same pages as an Admin but cannot ',
      'delete AI events.</p>',
      '</div>',

      // The admin's training / SMS-outage switch. Full width and set apart from the contact
      // fields above, because it is not a contact detail — it is a sign-in bypass, and it should
      // read as the deliberate, visible thing it is.
      '<label class="fixed-login" for="dx-fixed">',
      '<input class="fixed-login__check" id="dx-fixed" type="checkbox" />',
      '<span class="fixed-login__body">',
      '<span class="fixed-login__title">Sign in with the fixed code 123456</span>',
      '<span class="fixed-login__note">For a Mait being shown the app, or to keep sign-ins ',
      'working while SMS is down. This account types 123456 instead of a texted OTP. It takes ',
      'effect on their next code, applies to this account only, and every change is in the ',
      'audit log — turn it off once the training is over.</span>',
      '</span>',
      '</label>',

      '<div class="form-actions">',
      '<button class="btn btn--primary" type="button" id="dx-save">',
      glyph('M5 12.5l4.5 4.5L19 7.5'),
      'Save details</button>',
      '<button class="btn btn--soft" type="button" id="dx-cancel">',
      glyph('M6 6l12 12M18 6L6 18'),
      'Cancel</button>',
      '<p class="field__hint" id="dx-status">—</p>',
      '</div>',

      '</section>',
    ].join('');
  }

  function openDetailEditor(user) {
    state.detailing = user;

    $('#dx-initials').text(initials(user.full_name));
    $('#dx-name').text(user.full_name || user.username);
    $('#dx-username').text(user.username);
    $('#dx-role').html(rolePill(user));

    // The role is editable only between the two office roles that are the same account with one
    // capability different (Admin, Normal User). For a Super Admin or a Mait the select is not
    // shown — the pill above is the whole answer.
    const switchable = user.role === 'admin' || user.role === 'normal_user';
    $('#dx-role-field').prop('hidden', !switchable);
    if (switchable) {
      $('#dx-role-select').val(user.role);
    }

    $('#dx-full-name').val(user.full_name || '');
    $('#dx-email').val(user.email || '');
    $('#dx-mobile').val(user.mobile_no || '');
    $('#dx-fixed').prop('checked', !!user.fixed_otp_enabled);
    $('#dx-mobile-hint').text(
      (user.zone_names || []).length
        ? 'The number they sign into the app with. The Zones screen edits this same one.'
        : 'Optional for an office account — a number is only a sign-in for a zonal manager.'
    );
    $('#dx-status').text('—');

    $('#detail-panel').prop('hidden', false);
    $('#detail-panel')[0].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    $('#dx-full-name').trigger('focus');
  }

  function closeDetailEditor() {
    state.detailing = null;
    $('#detail-panel').prop('hidden', true);
  }

  function saveDetailEditor() {
    if (!state.detailing) {
      return;
    }
    const user = state.detailing;
    const fullName = ($('#dx-full-name').val() || '').trim();
    const email = ($('#dx-email').val() || '').trim();
    const mobile = ($('#dx-mobile').val() || '').trim();

    // Caught here rather than at the API, which would answer with a field error against a
    // panel that has already scrolled out of view.
    if (!fullName) {
      $('#dx-status').text('A name is what the rest of the portal calls this account.');
      $('#dx-full-name').trigger('focus');
      return;
    }
    if (mobile && !/^[6-9]\d{9}$/.test(mobile)) {
      $('#dx-status').text('A mobile number is ten digits, starting 6 to 9.');
      $('#dx-mobile').trigger('focus');
      return;
    }

    // Only what actually moved. Sending all three would write `mobile_no: ""` over a number
    // nobody touched — and on a zonal manager that number is their sign-in.
    const body = {};
    if (fullName !== (user.full_name || '')) {
      body.full_name = fullName;
    }
    if (email !== (user.email || '')) {
      body.email = email;
    }
    if (mobile !== (user.mobile_no || '')) {
      body.mobile_no = mobile;
    }
    const fixed = $('#dx-fixed').is(':checked');
    if (fixed !== !!user.fixed_otp_enabled) {
      body.fixed_otp_enabled = fixed;
    }
    // Only when the select is actually on screen (an office account) and the role moved. Both
    // roles are section-scoped, so the account keeps the pages it already had.
    if ((user.role === 'admin' || user.role === 'normal_user')) {
      const role = $('#dx-role-select').val();
      if (role !== user.role) {
        body.role = role;
      }
    }
    if (!Object.keys(body).length) {
      closeDetailEditor();
      return;
    }

    $('#dx-save').prop('disabled', true);
    $('#dx-status').text('Saving…');

    MaitAI.api
      .updateUser(user.id, body)
      .done(function (saved) {
        closeDetailEditor();
        if (saved && saved.id) {
          replaceRow(saved);
        } else {
          load();
        }
      })
      .fail(function (problem) {
        $('#dx-status').text('');
        MaitAI.shell.alert(MaitAI.api.problemToLines(problem).join(' · '));
      })
      .always(function () {
        $('#dx-save').prop('disabled', false);
      });
  }

  /* --- the credentials editor ---------------------------------------------------------------
   * How they sign in: the username, and the password behind it. Kept apart from the details
   * panel (name, email, number) on purpose — a password is the one field on this screen that
   * is a secret, and resetting it is a deliberate act, not something to do in the same breath
   * as fixing a spelling. Only an Admin reaches this screen, so the "admin only" rule is the
   * screen itself; the backend enforces it again on every write.
   *
   * A Mait has no password — they sign in to the app with a one-time code — so the password
   * fields are hidden for one and the panel offers only the username.
   */
  function credentialsEditorMarkup() {
    return [
      '<section class="panel editor credentials-editor" id="cred-panel" hidden ',
      'aria-label="Sign-in username and password">',

      '<div class="editor__head">',
      '<span class="editor__avatar" id="cx-initials" aria-hidden="true">—</span>',
      '<div class="editor__who">',
      '<h2 class="editor__name" id="cx-name">—</h2>',
      '<p class="editor__code" id="cx-username">—</p>',
      '</div>',
      '<span id="cx-role"></span>',
      '</div>',

      '<div class="form-grid">',

      '<div class="field field--iconed">',
      '<label class="field__label" for="cx-new-username">',
      '<span class="field__icon" aria-hidden="true">',
      glyph(PERSON),
      '</span>Username</label>',
      '<input class="input field__control" id="cx-new-username" type="text" maxlength="64" ',
      'autocomplete="off" />',
      '<p class="field__hint">What they type to sign in.</p>',
      '</div>',

      // Office accounts only. A reset is optional on every save — blank leaves the current
      // password untouched, so the panel can be opened to change the username alone.
      '<div class="field field--iconed" id="cx-password-field">',
      '<label class="field__label" for="cx-password">',
      '<span class="field__icon" aria-hidden="true">',
      glyph(KEY),
      '</span>New password</label>',
      '<input class="input field__control" id="cx-password" type="password" ',
      'autocomplete="new-password" />',
      '<p class="field__hint">At least 10 characters. Leave blank to keep the current one.</p>',
      '</div>',

      '<div class="field field--iconed" id="cx-confirm-field">',
      '<label class="field__label" for="cx-confirm">',
      '<span class="field__icon" aria-hidden="true">',
      glyph(KEY),
      '</span>Confirm new password</label>',
      '<input class="input field__control" id="cx-confirm" type="password" ',
      'autocomplete="new-password" />',
      '<p class="field__hint">Type it again, so a slip is caught here and not at their desk.</p>',
      '</div>',

      '</div>',

      // Shown in place of the password fields for a Mait, so the panel explains itself rather
      // than simply missing half its form.
      '<p class="field__hint" id="cx-mait-note" hidden>',
      'Maits sign in to the app with a one-time code, so they have no password to set.',
      '</p>',

      '<div class="form-actions">',
      '<button class="btn btn--primary" type="button" id="cx-save">',
      glyph('M5 12.5l4.5 4.5L19 7.5'),
      'Save sign-in</button>',
      '<button class="btn btn--soft" type="button" id="cx-cancel">',
      glyph('M6 6l12 12M18 6L6 18'),
      'Cancel</button>',
      '<p class="field__hint" id="cx-status">—</p>',
      '</div>',

      '</section>',
    ].join('');
  }

  function openCredentialsEditor(user) {
    state.crediting = user;
    // One panel at a time: two open over the same table, both headed by the same person, are
    // two saves an operator can mistake for one.
    closeEditor();
    closeZoneEditor();
    closeDetailEditor();

    const isMait = user.role === 'mait';
    $('#cx-initials').text(initials(user.full_name));
    $('#cx-name').text(user.full_name || user.username);
    $('#cx-username').text(user.username);
    $('#cx-role').html(rolePill(user));

    $('#cx-new-username').val(user.username);
    $('#cx-password, #cx-confirm').val('');
    $('#cx-password-field, #cx-confirm-field').prop('hidden', isMait);
    $('#cx-mait-note').prop('hidden', !isMait);
    $('#cx-status').text('—');

    $('#cred-panel').prop('hidden', false);
    $('#cred-panel')[0].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    $('#cx-new-username').trigger('focus');
  }

  function closeCredentialsEditor() {
    state.crediting = null;
    $('#cred-panel').prop('hidden', true);
  }

  function saveCredentialsEditor() {
    if (!state.crediting) {
      return;
    }
    const user = state.crediting;
    const isMait = user.role === 'mait';
    const username = ($('#cx-new-username').val() || '').trim();
    const password = $('#cx-password').val() || '';
    const confirm = $('#cx-confirm').val() || '';

    // Caught here rather than at the API, which would answer against a panel that has already
    // scrolled out of view.
    if (!username) {
      $('#cx-status').text('A username is what they type to sign in — it cannot be blank.');
      $('#cx-new-username').trigger('focus');
      return;
    }

    const body = {};
    if (username !== user.username) {
      body.username = username;
    }
    if (!isMait && password) {
      if (password.length < 10) {
        $('#cx-status').text('A password needs at least 10 characters.');
        $('#cx-password').trigger('focus');
        return;
      }
      if (password !== confirm) {
        $('#cx-status').text('The two passwords do not match.');
        $('#cx-confirm').trigger('focus');
        return;
      }
      body.password = password;
    }

    // Nothing to send — the username was left as it was and no password was typed.
    if (!Object.keys(body).length) {
      closeCredentialsEditor();
      return;
    }

    $('#cx-save').prop('disabled', true);
    $('#cx-status').text('Saving…');

    MaitAI.api
      .updateUser(user.id, body)
      .done(function (saved) {
        closeCredentialsEditor();
        if (saved && saved.id) {
          replaceRow(saved);
        } else {
          load();
        }
        const changed = body.username
          ? 'Username updated' + (body.password ? ' and password reset' : '')
          : 'Password reset';
        MaitAI.shell.alert(changed + ' for ' + (user.full_name || user.username) + '.', 'good');
      })
      .fail(function (problem) {
        $('#cx-status').text('');
        MaitAI.shell.alert(MaitAI.api.problemToLines(problem).join(' · '));
      })
      .always(function () {
        $('#cx-save').prop('disabled', false);
      });
  }

  /* --- the zone editor ---------------------------------------------------------------------
   * A second small panel rather than another field on the access one. They answer different
   * questions — which pages, versus how much of the network — and they are decided by
   * different people on different days: access is set when an account is created, a zone when
   * somebody moves region. Sharing a save would make one an accident of the other.
   */
  function zoneEditorMarkup() {
    return [
      '<section class="panel editor zone-scope" id="zone-panel" hidden ',
      'aria-label="Zones this account sees">',

      '<div class="editor__head">',
      '<span class="editor__avatar" id="zx-initials" aria-hidden="true">—</span>',
      '<div class="editor__who">',
      '<h2 class="editor__name" id="zx-name">—</h2>',
      '<p class="editor__code" id="zx-username">—</p>',
      '</div>',
      '<span id="zx-role"></span>',
      '</div>',

      '<div class="field field--iconed field--wide">',
      '<span class="field__label">',
      '<span class="field__icon field__icon--pages" aria-hidden="true">',
      MaitAI.shell.icon('zones'),
      '</span>Zones they see',
      '<span class="field__count" id="zx-count">—</span></span>',

      '<div class="access__quick">',
      '<button class="btn" type="button" id="zx-none">Whole network</button>',
      '</div>',

      '<div class="access" id="zx-grid" role="group" aria-label="Zones"></div>',
      '<p class="field__hint" id="zx-diff">—</p>',
      '</div>',

      // The number sits in the zone panel rather than beside the email, and that is the
      // whole argument for where it lives: on a head-office account it is a contact detail
      // nobody uses, and on a zoned one it is the thing that opens the app. It is decided
      // in the same breath as the zone, so it is saved in the same breath too.
      '<div class="field field--iconed">',
      '<label class="field__label" for="zx-mobile">',
      '<span class="field__icon field__icon--mobile" aria-hidden="true">',
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ',
      'stroke-linecap="round" stroke-linejoin="round">',
      '<path d="M7 2h10v20H7zM11 18h2"/></svg>',
      '</span>Mobile number</label>',
      '<input class="input field__control" id="zx-mobile" type="tel" inputmode="numeric" ',
      'maxlength="10" autocomplete="off" placeholder="9876543210" />',
      '<p class="field__hint" id="zx-app">—</p>',
      '</div>',

      '<div class="form-actions">',
      '<button class="btn btn--primary" type="button" id="zx-save">Save zone &amp; number</button>',
      '<button class="btn" type="button" id="zx-cancel">Cancel</button>',
      '<p class="field__hint" id="zx-status">—</p>',
      '</div>',

      '</section>',
    ].join('');
  }

  function zoneItem(zone, isOn) {
    return (
      '<label class="access__item' +
      (isOn ? ' is-on' : '') +
      '">' +
      '<input class="access__check" type="checkbox" value="' +
      ui.escapeHtml(zone.code) +
      '"' +
      (isOn ? ' checked' : '') +
      ' />' +
      '<span class="access__mark" aria-hidden="true">' +
      MaitAI.shell.icon('zones') +
      '</span>' +
      '<span class="access__name">' +
      ui.escapeHtml(zone.name) +
      // What the zone actually covers, on the line under its name. "Bahraich Zone" means
      // nothing to somebody who does not already know the region; the four chilling centres
      // in it are the whole of what the tick decides.
      '<span class="access__meta">' +
      ((zone.plant_names || []).length
        ? ui.escapeHtml(zone.plant_names.join(', '))
        : 'no BMC/MCC yet') +
      '</span>' +
      '</span>' +
      '<span class="access__state" aria-hidden="true"></span>' +
      '</label>'
    );
  }

  /**
   * What the two fields together decide, in one sentence under the number.
   *
   * Both are needed and neither is enough: a zone with no number is a manager nobody can
   * send a code to, and a number with no zone is an office account that would open an app
   * scoped to the whole network — which is why sign-in refuses it.
   */
  function renderAppLine() {
    const zoned = state.zonesChosen.length > 0;
    const numbered = String($('#zx-mobile').val() || '').trim().length > 0;
    const $hint = $('#zx-app').removeClass('field__hint--ok field__hint--warn');

    if (zoned && numbered) {
      $hint
        .addClass('field__hint--ok')
        .text('They can sign in to the zonal manager app on this number.');
      return;
    }
    if (zoned) {
      $hint
        .addClass('field__hint--warn')
        .text('Without a number they can only work in the portal — the app cannot send a code.');
      return;
    }
    if (numbered) {
      $hint.text('The app needs a zone as well. Without one this is only a contact number.');
      return;
    }
    $hint.text('Only a zonal manager needs one. An office account signs in with its password.');
  }

  function renderZoneDiff() {
    const chosen = state.zonesChosen;
    $('#zx-count').text(chosen.length ? chosen.length + ' zone(s)' : 'None — whole network');
    // Ticking nothing is a real and common setting rather than an unfinished form: it is what
    // every head-office account holds. Said out loud, because an empty grid otherwise reads as
    // a decision nobody has made yet.
    $('#zx-diff').text(
      chosen.length
        ? 'They will see only these zones — on the dashboard, the AI events list, members, ' +
            'the leaderboard and every export.'
        : 'No zone ticked means the whole network, which is what most accounts hold.'
    );
    renderAppLine();
  }

  function openZoneEditor(user) {
    state.zoning = user;
    state.zonesChosen = (user.zones || []).slice();
    // One panel at a time. Two open over the same table, both headed by the same person, are
    // two saves an operator can mistake for one.
    closeEditor();

    $('#zx-initials').text(initials(user.full_name));
    $('#zx-name').text(user.full_name || user.username);
    $('#zx-username').text(user.username);
    $('#zx-role').html(rolePill(user));
    $('#zx-status').text('—');
    $('#zx-mobile').val(user.mobile_no || '');

    $('#zx-grid').html(
      state.zones.length
        ? state.zones
            .map(function (zone) {
              return zoneItem(zone, state.zonesChosen.indexOf(zone.code) >= 0);
            })
            .join('')
        : '<p class="empty-state">No zones have been set up yet. ' +
            'Create them on the Zones screen first.</p>'
    );
    renderZoneDiff();

    $('#zone-panel').prop('hidden', false);
    $('#zone-panel')[0].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function closeZoneEditor() {
    state.zoning = null;
    $('#zone-panel').prop('hidden', true);
  }

  function saveZoneEditor() {
    if (!state.zoning) {
      return;
    }
    const id = state.zoning.id;
    const mobile = String($('#zx-mobile').val() || '').trim();
    $('#zx-save').prop('disabled', true);
    $('#zx-status').text('Saving…');

    // Sent only when it actually changed. The zone panel is opened to move somebody between
    // regions far more often than to give them a handset, and a PATCH that always carried
    // the number would re-validate it — refusing the save over a clash nobody touched.
    const body = { zones: state.zonesChosen };
    if (mobile !== String(state.zoning.mobile_no || '')) {
      body.mobile_no = mobile;
    }

    MaitAI.api
      .updateUser(id, body)
      .done(function (user) {
        closeZoneEditor();
        if (user && user.id) {
          replaceRow(user);
        } else {
          load();
        }
      })
      .fail(function (problem) {
        $('#zx-status').text('');
        MaitAI.shell.alert(MaitAI.api.problemToLines(problem).join(' · '));
      })
      .always(function () {
        $('#zx-save').prop('disabled', false);
      });
  }

  /** The zones an account can be given. Loaded once; the grid is drawn from it per row. */
  function loadZones() {
    MaitAI.api
      .zones()
      .done(function (page) {
        state.zones = (page.results || page || []).filter(function (zone) {
          // An inactive zone scopes nothing, so offering it would be a tick that does nothing.
          return zone.is_active;
        });
      })
      .fail(function () {
        // Not an alert. This screen's job is accounts and roles; zones are one column of it,
        // and a red banner over a working table because a secondary list failed would be the
        // loudest thing on screen for the least important reason. The editor says so itself
        // if somebody opens it.
        state.zones = [];
      });
  }

  $(function () {
    if (!MaitAI.shell.requireSession()) {
      return;
    }
    MaitAI.shell.mount();
    loadCatalogue();
    loadZones();
    $('#access-editor').html(
      editorMarkup() + zoneEditorMarkup() + detailEditorMarkup() + credentialsEditorMarkup()
    );
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

    /* --- bulk selection --------------------------------------------------------------------- */
    $('#rows').on('change', '.pick', renderBulk);

    $('#pick-all').on('change', function () {
      $('#rows .pick').prop('checked', $(this).is(':checked'));
      renderBulk();
    });

    $('#bulk-clear').on('click', function () {
      $('#rows .pick').prop('checked', false);
      renderBulk();
    });

    $('#bulk-activate').on('click', function () {
      const ids = wouldChange(picked(), 'is_active', true);
      if (ids.length) {
        runBulk(ids, 'is_active', true, 'Activating', 'activated');
      }
    });

    $('#bulk-deactivate').on('click', function () {
      const ids = wouldChange(picked(), 'is_active', false);
      if (!ids.length) {
        return;
      }
      // Asked once, and the number is in the question: switching off an account takes somebody
      // out of the portal, and the row button's single deliberate click is not what this is.
      if (
        !window.confirm(
          'Deactivate ' +
            ids.length +
            (ids.length === 1 ? ' account' : ' accounts') +
            '? They will not be able to sign in until somebody reactivates them.'
        )
      ) {
        return;
      }
      runBulk(ids, 'is_active', false, 'Deactivating', 'deactivated');
    });

    // The training / SMS-outage switch for a group. Confirmed once, with the number in the
    // question, because it is a sign-in bypass applied to several accounts at a time.
    $('#bulk-fixed-on').on('click', function () {
      const ids = wouldChange(picked(), 'fixed_otp_enabled', true);
      if (!ids.length) {
        return;
      }
      if (
        !window.confirm(
          'Turn the fixed login code (123456) on for ' +
            ids.length +
            (ids.length === 1 ? ' account' : ' accounts') +
            '? They will sign in by typing 123456 until you turn it off.'
        )
      ) {
        return;
      }
      runBulk(ids, 'fixed_otp_enabled', true, 'Turning on', 'now sign in with 123456');
    });

    $('#bulk-fixed-off').on('click', function () {
      const ids = wouldChange(picked(), 'fixed_otp_enabled', false);
      if (ids.length) {
        runBulk(ids, 'fixed_otp_enabled', false, 'Turning off', 'back on a texted code');
      }
    });

    /* --- the row's details editor ---------------------------------------------------------- */
    $('#rows').on('click', '[data-detail]', function () {
      const id = String($(this).data('detail'));
      const user = state.page.filter(function (candidate) {
        return String(candidate.id) === id;
      })[0];
      if (user) {
        openDetailEditor(user);
      }
    });

    $('#dx-cancel').on('click', closeDetailEditor);
    $('#dx-save').on('click', saveDetailEditor);

    /* --- the row's credentials editor (username & password) -------------------------------- */
    $('#rows').on('click', '[data-credentials]', function () {
      const id = String($(this).data('credentials'));
      const user = state.page.filter(function (candidate) {
        return String(candidate.id) === id;
      })[0];
      if (user) {
        openCredentialsEditor(user);
      }
    });

    $('#cx-cancel').on('click', closeCredentialsEditor);
    $('#cx-save').on('click', saveCredentialsEditor);

    /* --- the row's zone editor ------------------------------------------------------------ */
    $('#rows').on('click', '[data-zones]', function () {
      const id = String($(this).data('zones'));
      const user = state.page.filter(function (candidate) {
        return String(candidate.id) === id;
      })[0];
      if (user) {
        openZoneEditor(user);
      }
    });

    // Delegated from the document, because the grid is redrawn each time the panel opens and
    // a handler bound to the boxes themselves would go with the nodes they were bound to.
    $(document).on('change', '#zx-grid .access__check', function () {
      const code = $(this).val();
      const on = $(this).is(':checked');
      const at = state.zonesChosen.indexOf(code);
      if (on && at < 0) {
        state.zonesChosen.push(code);
      } else if (!on && at >= 0) {
        state.zonesChosen.splice(at, 1);
      }
      $(this).closest('.access__item').toggleClass('is-on', on);
      renderZoneDiff();
    });

    $('#zx-none').on('click', function () {
      setAll($('#zx-grid'), false);
      state.zonesChosen = [];
      renderZoneDiff();
    });

    // Digits only, and the sentence under it keeps up as they are typed — the field decides
    // whether an app opens, so it should not wait for a save to say so.
    $('#access-editor').on('input', '#zx-mobile', function () {
      this.value = this.value.replace(/\D/g, '').slice(0, 10);
      renderAppLine();
    });

    $('#zx-cancel').on('click', closeZoneEditor);
    $('#zx-save').on('click', saveZoneEditor);

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
          mobile_no: $('#new-mobile').val().trim(),
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
