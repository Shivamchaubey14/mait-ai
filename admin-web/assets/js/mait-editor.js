/**
 * The Mait editor — name, mobile and MPP coverage.
 *
 * Shared, because two screens open the same thing. On Assignment, coverage is the job. On
 * Maits, a row is corrected in place after a phone call. Written once so the two cannot drift
 * into looking like different controls for the same record.
 *
 * The panel renders its own markup into whatever container it is given, so a page adopting it
 * adds one empty element and a call rather than a copy of this form.
 *
 * Usage:
 *   MaitAI.maitEditor.mount('#mait-editor', function (saved) { ... });
 *   MaitAI.maitEditor.open(maitRow);
 */

window.MaitAI = window.MaitAI || {};

(function (MaitAI, $) {
  'use strict';

  const state = {
    $root: null,
    mait: null,
    codes: [],
    onSaved: null,
    suggestions: [],
    suggestAt: -1,
    suggestSeq: 0,
  };

  function ui() {
    return MaitAI.ui;
  }

  /** Two letters beat a grey circle, and there are no photographs to use. */
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

  function stateCell(mait) {
    if (!mait.mobile_no) {
      // The number is the only way in. Without one they cannot be activated at all.
      return ui().pill('No mobile', 'bad');
    }
    return mait.activated ? ui().pill('Active', 'good') : ui().pill('Not activated', 'warn');
  }

  /**
   * Split whatever was pasted into MPP codes.
   *
   * Codes arrive as a comma list, as lines out of a spreadsheet column, or space-separated.
   * Making an operator reformat a paste is making them retype codes, which is where the typos
   * come from.
   */
  function parseCodes(text) {
    return (text || '')
      .split(/[\s,;]+/)
      .map(function (code) {
        return code.trim();
      })
      .filter(Boolean);
  }

  /* `className` is optional — a field's glyph is sized by its chip, a button's by `.btn__icon`,
     which also stops it being squeezed by a long label. */
  function icon(path, className) {
    return (
      '<svg class="' +
      (className || '') +
      '" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="' +
      path +
      '" /></svg>'
    );
  }

  function markup() {
    return [
      '<section class="panel editor" id="mait-editor-panel" aria-label="Edit Mait" hidden>',
      // The header identifies who is being changed. Three fields on a white card look alike,
      // and the one thing that must never be in doubt is whose record this is.
      '<div class="editor__head">',
      '<span class="editor__avatar" id="me-initials" aria-hidden="true">—</span>',
      '<div class="editor__who">',
      '<h2 class="editor__name" id="me-name">—</h2>',
      '<p class="editor__code" id="me-code">—</p>',
      '</div>',
      '<span id="me-state"></span>',
      '</div>',

      // Not a <form>: saving is the only action, and the field that matters is a list pasted
      // in from a spreadsheet as often as it is typed.
      '<div class="form-grid">',

      '<div class="field field--iconed">',
      '<label class="field__label" for="me-input-name">',
      '<span class="field__icon field__icon--name" aria-hidden="true">',
      icon('M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M5 21a7 7 0 0 1 14 0'),
      '</span>Name</label>',
      '<input class="input field__control" id="me-input-name" type="text" maxlength="150" />',
      '<p class="field__hint">As the office refers to them</p>',
      '</div>',

      '<div class="field field--iconed">',
      '<label class="field__label" for="me-input-mobile">',
      '<span class="field__icon field__icon--mobile" aria-hidden="true">',
      icon('M7 2h10v20H7zM11 18h2'),
      '</span>Mobile number</label>',
      '<input class="input field__control" id="me-input-mobile" type="tel" ',
      'inputmode="numeric" maxlength="14" placeholder="98765 43210" />',
      // The only channel into the app: the sign-in OTP goes here and nothing else does, so a
      // wrong digit locks the Mait out and texts a stranger.
      '<p class="field__hint">Their only way into the app</p>',
      '</div>',

      // Full width: coverage is the field the editor exists for.
      '<div class="field field--iconed field--wide">',
      '<label class="field__label" for="me-add">',
      '<span class="field__icon field__icon--mpps" aria-hidden="true">',
      icon('M12 21s7-5.3 7-11a7 7 0 1 0-14 0c0 5.7 7 11 7 11M12 10h.01'),
      '</span>MPPs they cover',
      '<span class="field__count" id="me-count">0</span></label>',

      // Chips rather than a wall of text: removing one village should not mean finding it
      // inside a paragraph and deleting the right comma.
      '<div class="chip-box">',
      '<div class="chip-box__chips" id="me-chips"></div>',
      '<div class="chip-box__add">',
      // The input is wrapped so the suggestion list can hang off it. A code on its own says
      // nothing about which village it is, and an operator assigning coverage from a phone call
      // is working from a village name, not from a six-digit number.
      '<div class="suggest-wrap">',
      '<input class="input chip-box__input" id="me-add" type="text" spellcheck="false" ',
      'autocomplete="off" role="combobox" aria-expanded="false" aria-autocomplete="list" ',
      'aria-controls="me-suggest" ',
      'placeholder="Type a code or a village name — 001302, or BAROLI" />',
      '<div class="suggest" id="me-suggest" role="listbox" hidden></div>',
      '</div>',
      '<button class="btn btn--good-outline" id="me-add-go" type="button">',
      icon('M12 5v14M5 12h14', 'btn__icon'),
      'Add</button>',
      '</div></div>',
      '<p class="field__hint" id="me-hint">',
      'This is the complete list — anything removed here is unassigned.</p>',
      '</div>',

      // Cancel was wearing `btn--danger`, the solid red this portal keeps for logging out and
      // for rejecting an indent. Walking away from an edit is neither.
      '<div class="form-actions">',
      '<button class="btn btn--primary" id="me-save" type="button">',
      icon('M5 12.5l4.5 4.5L19 7.5', 'btn__icon'),
      'Save changes</button>',
      '<button class="btn" id="me-cancel" type="button">',
      icon('M6 6l12 12M18 6L6 18', 'btn__icon'),
      'Cancel</button>',
      '<p class="field__hint" id="me-status">—</p>',
      '</div>',

      '</div></section>',
    ].join('');
  }

  function chip(code) {
    const isNew = (state.mait.mpp_codes || []).indexOf(code) < 0;
    return (
      '<span class="mpp-chip' +
      (isNew ? ' mpp-chip--new' : '') +
      '">' +
      ui().escapeHtml(code) +
      '<button class="mpp-chip__remove" type="button" data-remove="' +
      ui().escapeHtml(code) +
      '" aria-label="Remove ' +
      ui().escapeHtml(code) +
      '">' +
      '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" ' +
      'stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>' +
      '</button></span>'
    );
  }

  /**
   * Redraw the chips, the count and what the change costs.
   *
   * Removals are named rather than counted: taking an MPP away is the direction that stops a
   * Mait working somewhere, and "unassigning 001371" is a sentence an operator can check.
   */
  function renderCodes() {
    if (!state.mait) {
      return;
    }
    const before = state.mait.mpp_codes || [];
    const removed = before.filter(function (code) {
      return state.codes.indexOf(code) < 0;
    });
    const added = state.codes.filter(function (code) {
      return before.indexOf(code) < 0;
    });

    $('#me-chips').html(
      state.codes.length
        ? state.codes.map(chip).join('')
        : '<p class="chip-box__empty">No MPPs — this Mait would be able to record nothing.</p>'
    );
    $('#me-count').text(state.codes.length);

    const notes = [];
    if (added.length) {
      notes.push('adding ' + added.join(', '));
    }
    if (removed.length) {
      notes.push('unassigning ' + removed.join(', '));
    }

    $('#me-hint')
      .toggleClass('field__hint--bad', removed.length > 0)
      .toggleClass('field__hint--ok', added.length > 0 && !removed.length)
      .text(
        notes.length
          ? notes.join(' · ')
          : 'This is the complete list — anything removed here is unassigned.'
      );
  }

  /* --- suggestions ---------------------------------------------------------------------
   * A code is six digits and says nothing about which village it is. An operator assigning
   * coverage is usually on the phone working from a name, and the one thing they cannot see
   * from the code alone is the thing that matters most: an MPP already covered by someone else
   * does not get added here, it gets *moved*, and the other Mait stops seeing those members.
   * So each row says who has it now.
   */

  const SUGGEST_LIMIT = 8;

  /** Which Mait holds this MPP today, as a pill — the reason to read the row. */
  function heldBy(mpp) {
    if (state.codes.indexOf(mpp.mpp_code) >= 0) {
      return ui().pill('Already added', 'info');
    }
    if (!mpp.mait_code) {
      return ui().pill('Unassigned', 'warn');
    }
    if (state.mait && mpp.mait_code === state.mait.sahayak_vendor_code) {
      return ui().pill('Theirs already', 'good');
    }
    // The one that costs something. Adding it here takes it off the Mait named.
    return ui().pill('Moves from ' + mpp.mait_name, 'bad');
  }

  function suggestRow(mpp, index) {
    const taken = state.codes.indexOf(mpp.mpp_code) >= 0;
    const where = [mpp.village_code, mpp.tehsil_code].filter(Boolean).join(' · ');
    return (
      '<button class="suggest__row" type="button" role="option" aria-selected="' +
      (index === state.suggestAt) +
      '" data-code="' +
      ui().escapeHtml(mpp.mpp_code) +
      '"' +
      (taken ? ' disabled' : '') +
      '>' +
      '<span class="suggest__code">' +
      ui().escapeHtml(mpp.mpp_code) +
      '</span>' +
      '<span class="suggest__body">' +
      '<span class="suggest__name">' +
      ui().escapeHtml(mpp.mpp_name || '—') +
      (mpp.is_active ? '' : ' <span class="suggest__retired">retired</span>') +
      '</span>' +
      '<span class="suggest__meta">' +
      (where ? ui().escapeHtml(where) + ' · ' : '') +
      ui().number(mpp.member_count || 0) +
      ' members</span>' +
      '</span>' +
      heldBy(mpp) +
      '</button>'
    );
  }

  function closeSuggest() {
    state.suggestions = [];
    state.suggestAt = -1;
    $('#me-suggest').prop('hidden', true).empty();
    $('#me-add').attr('aria-expanded', 'false');
  }

  function renderSuggest() {
    const $box = $('#me-suggest');
    if (!state.suggestions.length) {
      $box.prop('hidden', false).html('<p class="suggest__none">No MPP matches that.</p>');
      $('#me-add').attr('aria-expanded', 'true');
      return;
    }
    $box.prop('hidden', false).html(state.suggestions.map(suggestRow).join(''));
    $('#me-add').attr('aria-expanded', 'true');
  }

  function moveSuggest(step) {
    if (!state.suggestions.length) {
      return;
    }
    const last = state.suggestions.length - 1;
    state.suggestAt = Math.min(last, Math.max(0, state.suggestAt + step));
    renderSuggest();
    const row = $('#me-suggest .suggest__row')[state.suggestAt];
    if (row) {
      row.scrollIntoView({ block: 'nearest' });
    }
  }

  /**
   * Ask the server what matches.
   *
   * `seq` guards against a slow answer for "00" landing after a fast one for "001302" and
   * replacing a good list with a stale one.
   */
  function suggest(term) {
    const text = (term || '').trim();
    if (text.length < 2) {
      closeSuggest();
      return;
    }

    const mine = (state.suggestSeq = (state.suggestSeq || 0) + 1);
    MaitAI.api
      .mpps({ search: text, limit: SUGGEST_LIMIT })
      .done(function (page) {
        if (mine !== state.suggestSeq || !state.mait) {
          return;
        }
        state.suggestions = page.results || [];
        state.suggestAt = state.suggestions.length ? 0 : -1;
        renderSuggest();
      })
      .fail(function () {
        // A failed lookup is not a failed edit — the codes can still be typed straight in.
        closeSuggest();
      });
  }

  /** Accepts one code or a whole column pasted out of the sheet. */
  function addCodes(text) {
    const fresh = parseCodes(text).filter(function (code) {
      return state.codes.indexOf(code) < 0;
    });
    if (!fresh.length) {
      return;
    }
    state.codes = state.codes.concat(fresh);
    renderCodes();
  }

  function close() {
    state.mait = null;
    state.codes = [];
    closeSuggest();
    $('#mait-editor-panel').prop('hidden', true);
  }

  function open(mait) {
    if (!mait) {
      return;
    }
    state.mait = mait;
    state.codes = (mait.mpp_codes || []).slice();

    $('#mait-editor-panel').prop('hidden', false);
    $('#me-initials').text(initials(mait.name));
    $('#me-name').text(mait.name || 'Mait');
    $('#me-code').text(mait.sahayak_vendor_code);
    $('#me-state').html(stateCell(mait));
    $('#me-input-name').val(mait.name || '');
    $('#me-input-mobile').val(mait.mobile_no || '');
    $('#me-add').val('');
    $('#me-status').text('');
    closeSuggest();
    renderCodes();

    $('#mait-editor-panel')[0].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    $('#me-input-mobile').trigger('focus');
  }

  function save() {
    const mait = state.mait;
    const codes = state.codes;
    const mobile = ($('#me-input-mobile').val() || '').replace(/\D/g, '');
    const before = mait.mpp_codes || [];
    const removed = before.filter(function (code) {
      return codes.indexOf(code) < 0;
    });

    if (
      removed.length &&
      !window.confirm(
        'Unassign ' +
          removed.join(', ') +
          ' from ' +
          mait.name +
          '?\n\nThey will stop seeing those members and cannot record an AI event there.'
      )
    ) {
      return;
    }

    $('#me-save').prop('disabled', true);
    MaitAI.api
      .updateMait(mait.sahayak_vendor_code, {
        name: ($('#me-input-name').val() || '').trim(),
        mobile_no: mobile,
        mpp_codes: codes,
      })
      .done(function (saved) {
        close();
        if (typeof state.onSaved === 'function') {
          state.onSaved(saved);
        }
      })
      .fail(function (problem) {
        // The server owns every rule that matters — a duplicate number, an MPP that does not
        // exist. Show what it said rather than guessing in the browser.
        $('#me-status').text(MaitAI.api.problemToLines(problem).join(' · '));
      })
      .always(function () {
        $('#me-save').prop('disabled', false);
      });
  }

  MaitAI.maitEditor = {
    /** Render the panel into `selector` and wire it. `onSaved` receives the updated row. */
    mount: function (selector, onSaved) {
      state.$root = $(selector);
      state.onSaved = onSaved;
      state.$root.html(markup());

      $('#me-add-go').on('click', function () {
        addCodes($('#me-add').val());
        $('#me-add').val('').trigger('focus');
        closeSuggest();
      });

      // Typing asks what matches. Debounced, because this is one request per keystroke
      // otherwise against a table of 1,776 collection points.
      let lookup = null;
      $('#me-add').on('input', function () {
        const text = $(this).val();
        window.clearTimeout(lookup);
        lookup = window.setTimeout(function () {
          suggest(text);
        }, 220);
      });

      $('#me-add').on('keydown', function (event) {
        const open = state.suggestions.length > 0 && !$('#me-suggest').prop('hidden');

        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          if (open) {
            event.preventDefault();
            moveSuggest(event.key === 'ArrowDown' ? 1 : -1);
          }
          return;
        }

        if (event.key === 'Escape' && open) {
          event.preventDefault();
          closeSuggest();
          return;
        }

        // Enter takes the highlighted suggestion when there is one, and otherwise adds
        // whatever was typed — which is how a pasted list of codes still gets in.
        if (event.key === 'Enter') {
          event.preventDefault();
          window.clearTimeout(lookup);
          const picked = open && state.suggestAt >= 0 && state.suggestions[state.suggestAt];
          addCodes(picked ? picked.mpp_code : $(this).val());
          $(this).val('');
          closeSuggest();
        }
      });

      $('#me-suggest').on('click', '[data-code]', function () {
        addCodes(String($(this).data('code')));
        $('#me-add').val('').trigger('focus');
        closeSuggest();
      });

      // Clicking anywhere else puts the list away, the same way the portal's own menus behave.
      $(document).on('mousedown.maiteditor', function (event) {
        if (!$(event.target).closest('.suggest-wrap').length) {
          closeSuggest();
        }
      });

      // A pasted column lands as chips immediately rather than sitting as uncommitted text.
      // No lookup for this path: a paste is a list someone already has, not a search.
      $('#me-add').on('paste', function () {
        const $input = $(this);
        window.setTimeout(function () {
          window.clearTimeout(lookup);
          addCodes($input.val());
          $input.val('');
          closeSuggest();
        }, 0);
      });

      $('#me-chips').on('click', '[data-remove]', function () {
        const code = String($(this).data('remove'));
        state.codes = state.codes.filter(function (kept) {
          return kept !== code;
        });
        renderCodes();
      });

      $('#me-cancel').on('click', close);
      $('#me-save').on('click', save);
    },

    open: open,
    close: close,
    stateCell: stateCell,
  };
})(window.MaitAI, jQuery);
