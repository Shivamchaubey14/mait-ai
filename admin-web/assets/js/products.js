/**
 * Product catalogue (W18).
 *
 * Everything a Mait can ask for, in three kinds: consumables that run out, equipment issued
 * once and kept, and straws. The first two are one catalogue keyed by id; straws are the
 * breed list, keyed by breed and animal type and carrying a Hindi label the others do not.
 * They share a screen because they are one question — what can be requested — and differ
 * only in what identifies a row.
 *
 * This list is what names an indent. A request is stored against something from here, so
 * anything missing reaches the depot as "25 × Consumable" — a quantity of something.
 *
 * Individual straws are never typed in. They arrive by being issued against an indent, by
 * number or as a bundle of a breed, and the Mait names each one as they use it.
 */

(function (MaitAI, $) {
  'use strict';

  const ui = MaitAI.ui;

  const state = { kind: 'consumable', rows: [], editing: null, showRetired: false };

  const straws = function () {
    return state.kind === 'straw';
  };

  function money(value) {
    const rate = Number(value || 0);
    return rate > 0 ? '₹' + rate.toFixed(2) : '<span class="table__sub">not priced</span>';
  }

  function kindPill() {
    if (straws()) {
      return ui.pill('Straw', 'warn');
    }
    return state.kind === 'asset' ? ui.pill('Equipment', 'info') : ui.pill('Consumable', 'good');
  }

  /** Unit for a catalogue product; the animal it belongs to for a breed. */
  function measure(row_) {
    if (!straws()) {
      return ui.escapeHtml(row_.unit || '—');
    }
    return row_.animal_type === 'BUFF' ? 'Buffalo' : 'Cow';
  }

  function row(item) {
    return (
      '<tr' +
      (item.is_active ? '' : ' class="is-blocked"') +
      '>' +
      '<td><span class="table__code">' +
      ui.escapeHtml(item.code) +
      '</span></td>' +
      '<td>' +
      ui.escapeHtml(item.name) +
      // The Hindi label is what a Mait actually reads with the toggle on, so it is shown
      // rather than left to be discovered by switching the app over.
      (straws() && item.name_hi
        ? '<span class="table__sub">' + ui.escapeHtml(item.name_hi) + '</span>'
        : '') +
      '</td>' +
      '<td>' +
      kindPill() +
      '</td>' +
      '<td>' +
      measure(item) +
      '</td>' +
      '<td>' +
      money(item.rate) +
      '</td>' +
      '<td>' +
      (item.is_active ? ui.pill('In use', 'good') : ui.pill('Retired', 'bad')) +
      '</td>' +
      '<td><button class="btn" type="button" data-edit="' +
      item.id +
      '">Edit</button></td>' +
      '</tr>'
    );
  }

  /* --- editor ---------------------------------------------------------------------------- */

  function closeEditor() {
    state.editing = null;
    $('#editor').prop('hidden', true);
  }

  function openEditor(item) {
    state.editing = item || null;
    const adding = !item;
    const straw = straws();

    // Two jobs from one panel, so it says which by its colour. "Add" and "Edit SHEATH" in the
    // same white box are two words apart, and an operator who mis-reads that edits the wrong
    // row — green brings something new onto the list, blue corrects what is already on it.
    $('#editor').prop('hidden', false).toggleClass('product-editor--adding', adding);
    $('#editor-title').html(
      adding
        ? straw
          ? 'Add a breed'
          : 'Add a product'
        : 'Edit <span class="product-editor__subject">' + ui.escapeHtml(item.code) + '</span>'
    );

    $('#code')
      .val(adding ? '' : item.code)
      .prop('readonly', !adding);
    $('#code-hint').text(
      adding
        ? 'Set once and never changed'
        : straw
          ? 'Fixed — straws and animals already point at this breed'
          : 'Fixed — indents already point at this code'
    );
    $('#name').val(adding ? '' : item.name);
    $('#name-hi').val(adding || !straw ? '' : item.name_hi || '');
    $('#animal-type')
      .val(adding ? 'COW' : item.animal_type || 'COW')
      .prop('disabled', !adding);
    $('#category').val(adding ? state.kind : item.category || 'consumable');
    $('#unit').val(adding ? 'piece' : item.unit || 'piece');
    $('#rate').val(adding ? '' : Number(item.rate || 0));
    $('#display-order').val(adding ? 0 : item.display_order);

    // A breed is not a catalogue row: it has no unit and no consumable/equipment split, and
    // it does carry a second label. Showing the fields that do not apply invites filling them.
    $('#field-name-hi').prop('hidden', !straw);
    $('#field-animal').prop('hidden', !straw);
    $('#field-category').prop('hidden', straw);
    $('#field-unit').prop('hidden', straw);

    $('#retire').prop('hidden', adding || !item.is_active);
    $('#restore').prop('hidden', adding || item.is_active);
    $('#remove').prop('hidden', adding);
    $('#editor-hint').text(
      adding
        ? 'It appears on the request form as soon as you save.'
        : 'Delete only removes it if nothing points at it yet.'
    );

    $('#editor')[0].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    (adding ? $('#code') : $('#name')).trigger('focus');
  }

  function payload() {
    const body = {
      code: ($('#code').val() || '').trim().toUpperCase(),
      name: ($('#name').val() || '').trim(),
      rate: Number($('#rate').val() || 0).toFixed(2),
      display_order: Number($('#display-order').val() || 0),
    };
    if (straws()) {
      body.name_hi = ($('#name-hi').val() || '').trim();
      body.animal_type = $('#animal-type').val();
    } else {
      body.category = $('#category').val();
      body.unit = ($('#unit').val() || '').trim() || 'piece';
    }
    return body;
  }

  /* --- api per kind ---------------------------------------------------------------------- */

  const api = {
    list: function () {
      return straws() ? MaitAI.api.breeds() : MaitAI.api.products({ limit: 200 });
    },
    create: function (body) {
      return straws() ? MaitAI.api.createBreed(body) : MaitAI.api.createProduct(body);
    },
    update: function (id, body) {
      return straws() ? MaitAI.api.updateBreed(id, body) : MaitAI.api.updateProduct(id, body);
    },
    remove: function (id) {
      return straws() ? MaitAI.api.deleteBreed(id) : MaitAI.api.deleteProduct(id);
    },
  };

  function failed(problem) {
    MaitAI.shell.alert(MaitAI.api.problemToLines(problem).join(' · '));
  }

  function busy(on) {
    $('#save, #retire, #restore, #remove').prop('disabled', on);
  }

  function afterSave(message) {
    closeEditor();
    MaitAI.shell.alert(message, 'warn');
    load();
  }

  /* --- loading --------------------------------------------------------------------------- */

  function visibleRows() {
    const term = ($('#search').val() || '').trim().toLowerCase();
    return state.rows.filter(function (item) {
      if (!state.showRetired && !item.is_active) {
        return false;
      }
      if (!straws() && item.category !== state.kind) {
        return false;
      }
      if (!term) {
        return true;
      }
      return (
        String(item.code).toLowerCase().indexOf(term) >= 0 ||
        String(item.name).toLowerCase().indexOf(term) >= 0 ||
        String(item.name_hi || '').indexOf(term) >= 0
      );
    });
  }

  function render() {
    const shown = visibleRows();
    const unpriced = shown.filter(function (item) {
      return Number(item.rate || 0) === 0;
    }).length;

    $('#col-measure').text(straws() ? 'Animal' : 'Unit');
    $('#product-count').text(
      shown.length + ' shown' + (unpriced ? ' · ' + unpriced + ' not priced' : '')
    );
    $('#add').text(straws() ? 'Add a breed' : 'Add a product');
    ui.rows($('#rows'), shown, row, 'Nothing here yet. Add the first one.', 7);
  }

  function load() {
    MaitAI.shell.clearAlert();
    api
      .list()
      .done(function (page) {
        state.rows = page.results || page || [];
        render();
      })
      .fail(function (problem) {
        MaitAI.shell.alert(problem.detail);
        ui.rows($('#rows'), [], row, 'Could not load the catalogue.', 7);
      });
  }

  function selectKind(kind) {
    state.kind = kind;
    closeEditor();
    $('#kind-consumable, #kind-asset, #kind-straw')
      .removeClass('is-active')
      .attr('aria-pressed', 'false');
    $('#kind-' + kind)
      .addClass('is-active')
      .attr('aria-pressed', 'true');
    load();
  }

  $(function () {
    if (!MaitAI.shell.requireSession()) {
      return;
    }
    MaitAI.shell.mount();
    load();

    $('#kind-consumable').on('click', function () {
      selectKind('consumable');
    });
    $('#kind-asset').on('click', function () {
      selectKind('asset');
    });
    $('#kind-straw').on('click', function () {
      selectKind('straw');
    });

    // Filtered on rows already fetched: both lists are a couple of dozen entries, and a round
    // trip per keystroke would buy nothing.
    $('#search').on('input', render);

    $('#filter-retired').on('click', function () {
      state.showRetired = !state.showRetired;
      $(this)
        .toggleClass('is-active', state.showRetired)
        .attr('aria-pressed', String(state.showRetired));
      render();
    });

    $('#add').on('click', function () {
      MaitAI.shell.clearAlert();
      openEditor(null);
    });

    $('#cancel').on('click', closeEditor);

    // Delegated: the table is rebuilt on every load.
    $('#rows').on('click', '[data-edit]', function () {
      const id = Number($(this).data('edit'));
      const item = state.rows.filter(function (row_) {
        return row_.id === id;
      })[0];
      if (item) {
        MaitAI.shell.clearAlert();
        openEditor(item);
      }
    });

    $('#save').on('click', function () {
      const body = payload();
      if (!body.code || !body.name) {
        $('#editor-hint').text('A code and a name are both needed.');
        return;
      }

      busy(true);
      (state.editing ? api.update(state.editing.id, body) : api.create(body))
        .done(function (saved) {
          afterSave(saved.name + ' saved.');
        })
        .fail(failed)
        .always(function () {
          busy(false);
        });
    });

    $('#retire').on('click', function () {
      const item = state.editing;
      if (
        !window.confirm(
          'Retire ' +
            item.name +
            '?\n\nIt disappears from the request form. Records already made against it are ' +
            'untouched, and you can bring it back later.'
        )
      ) {
        return;
      }
      busy(true);
      api
        .update(item.id, { is_active: false })
        .done(function () {
          afterSave(item.name + ' retired. Maits can no longer request it.');
        })
        .fail(failed)
        .always(function () {
          busy(false);
        });
    });

    $('#restore').on('click', function () {
      const item = state.editing;
      busy(true);
      api
        .update(item.id, { is_active: true })
        .done(function () {
          afterSave(item.name + ' is back on the request form.');
        })
        .fail(failed)
        .always(function () {
          busy(false);
        });
    });

    $('#remove').on('click', function () {
      const item = state.editing;
      if (
        !window.confirm(
          'Delete ' +
            item.name +
            ' outright?\n\nOnly possible while nothing points at it. If it is already on an ' +
            'indent or in a Mait’s stock the server will refuse — retire it instead.'
        )
      ) {
        return;
      }
      busy(true);
      api
        .remove(item.id)
        .done(function () {
          afterSave(item.name + ' deleted.');
        })
        .fail(failed)
        .always(function () {
          busy(false);
        });
    });
  });
})(window.MaitAI, jQuery);
