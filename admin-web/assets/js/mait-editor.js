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

  const state = { $root: null, mait: null, codes: [], onSaved: null };

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

  function icon(path) {
    return (
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="' +
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
      '<input class="input chip-box__input" id="me-add" type="text" spellcheck="false" ',
      'autocomplete="off" placeholder="Type or paste codes — 001302, 001308" />',
      '<button class="btn btn--primary" id="me-add-go" type="button">Add</button>',
      '</div></div>',
      '<p class="field__hint" id="me-hint">',
      'This is the complete list — anything removed here is unassigned.</p>',
      '</div>',

      '<div class="form-actions">',
      '<button class="btn btn--primary" id="me-save" type="button">Save changes</button>',
      '<button class="btn btn--danger" id="me-cancel" type="button">Cancel</button>',
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
      });

      // Enter adds without reaching for the button, which is how a list gets typed.
      $('#me-add').on('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          addCodes($(this).val());
          $(this).val('');
        }
      });

      // A pasted column lands as chips immediately rather than sitting as uncommitted text.
      $('#me-add').on('paste', function () {
        const $input = $(this);
        window.setTimeout(function () {
          addCodes($input.val());
          $input.val('');
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
