/**
 * Rates (W18) — what one insemination costs, by breed.
 *
 * Two prices for the same service, because they are settled in different worlds: a member's is
 * taken out of a milk payment the dairy already owes her, a non-member's is cash handed to a
 * Mait in a yard. Keeping them apart is what lets the dairy price them apart, which it does.
 *
 * **A zero is not free, it is unpriced** — and the consequence of one is invisible from this
 * desk. It lands on a Mait standing in a yard with the animal already served and the straw
 * already spent, told to ask an administrator. So the unpriced count is the first tile on the
 * page and its own filter, rather than something to be noticed by reading down a column.
 *
 * Edited in place and saved together. Pricing is a decision made across a list — "cows at 300,
 * buffaloes at 350" — and a form per breed would make eighteen small decisions out of two.
 */

(function (MaitAI, $) {
  'use strict';

  const ui = MaitAI.ui;

  /** Every breed as the API returned it, keyed by id, plus whatever has been typed since. */
  let breeds = [];
  const edits = {};

  let kind = 'COW';
  let search = '';

  function unpriced(breed) {
    return !Number(rateOf(breed, 'rate')) || !Number(rateOf(breed, 'non_member_rate'));
  }

  /** The typed value where there is one, the saved value otherwise. */
  function rateOf(breed, field) {
    const edit = edits[breed.id];
    return edit && edit[field] !== undefined ? edit[field] : breed[field];
  }

  function dirty(breed) {
    const edit = edits[breed.id];
    if (!edit) {
      return false;
    }
    return ['rate', 'non_member_rate'].some(function (field) {
      return edit[field] !== undefined && Number(edit[field]) !== Number(breed[field]);
    });
  }

  function visible() {
    const term = search.trim().toLowerCase();
    return breeds.filter(function (breed) {
      if (kind === 'unpriced') {
        if (!unpriced(breed)) {
          return false;
        }
      } else if (breed.animal_type !== kind) {
        return false;
      }
      if (!term) {
        return true;
      }
      return (
        (breed.name || '').toLowerCase().indexOf(term) >= 0 ||
        (breed.code || '').toLowerCase().indexOf(term) >= 0
      );
    });
  }

  /* A number field per rate, tagged with the breed and which of the two it is. */
  function rateCell(breed, field) {
    return (
      '<td class="table__num">' +
      '<input class="input input--rate" type="number" min="0" step="1" ' +
      'inputmode="numeric" data-id="' +
      breed.id +
      '" data-field="' +
      field +
      '" value="' +
      ui.escapeHtml(String(Math.round(Number(rateOf(breed, field)) || 0))) +
      '" aria-label="' +
      ui.escapeHtml(breed.name + ' — ' + (field === 'rate' ? 'member rate' : 'non-member rate')) +
      '" />' +
      '</td>'
    );
  }

  function row(breed) {
    return (
      '<tr' +
      (unpriced(breed) ? ' class="is-blocked"' : '') +
      '>' +
      '<td>' +
      ui.identity(breed.name, breed.code) +
      '</td>' +
      rateCell(breed, 'rate') +
      rateCell(breed, 'non_member_rate') +
      '<td>' +
      (dirty(breed)
        ? ui.pill('Unsaved', 'warn')
        : unpriced(breed)
          ? ui.pill('Not priced', 'bad')
          : ui.pill('Priced', 'good')) +
      '</td>' +
      '</tr>'
    );
  }

  function summarise() {
    const priced = breeds.filter(function (breed) {
      return !unpriced(breed);
    });
    const range = function (field) {
      if (!priced.length) {
        return '—';
      }
      const values = priced.map(function (breed) {
        return Number(rateOf(breed, field));
      });
      const low = Math.min.apply(null, values);
      const high = Math.max.apply(null, values);
      return low === high ? ui.money(low) : ui.money(low) + '–' + ui.money(high);
    };

    $('#unpriced').text(
      breeds.filter(function (breed) {
        return unpriced(breed);
      }).length
    );
    $('#member-range').text(range('rate'));
    $('#non-member-range').text(range('non_member_rate'));
  }

  function render() {
    ui.rows($('#rows'), visible(), row, 'No breeds match that search.', 4);
    summarise();
  }

  function load() {
    MaitAI.shell.clearAlert();
    MaitAI.api
      .breeds()
      .done(function (data) {
        breeds = data.results || data || [];
        render();
      })
      .fail(function (problem) {
        MaitAI.shell.alert(problem.detail);
        ui.rows($('#rows'), [], row, 'Could not load the breed list.', 4);
      });
  }

  /**
   * Save every breed whose rate was changed, and nothing else.
   *
   * One request each, because that is what the API offers and eighteen breeds is not a batch
   * worth an endpoint. Reported together: a Mait cannot use half a price list, so a partial
   * failure has to say which rows did not land.
   */
  function saveAll() {
    const changed = breeds.filter(dirty);
    if (!changed.length) {
      MaitAI.shell.alert('Nothing has changed.', 'good');
      return;
    }

    const $button = $('#save-all').prop('disabled', true).text('Saving…');
    const failures = [];

    const requests = changed.map(function (breed) {
      const edit = edits[breed.id] || {};
      const body = {
        rate: Number(edit.rate !== undefined ? edit.rate : breed.rate) || 0,
        non_member_rate:
          Number(
            edit.non_member_rate !== undefined ? edit.non_member_rate : breed.non_member_rate
          ) || 0,
      };
      return MaitAI.api
        .updateBreed(breed.id, body)
        .done(function (saved) {
          breed.rate = saved.rate;
          breed.non_member_rate = saved.non_member_rate;
          delete edits[breed.id];
        })
        .fail(function () {
          failures.push(breed.name || breed.code);
        });
    });

    $.when.apply($, requests).always(function () {
      $button.prop('disabled', false).text('Save changes');
      render();
      if (failures.length) {
        MaitAI.shell.alert('Could not save: ' + failures.join(', ') + '.');
      } else {
        MaitAI.shell.alert(
          changed.length + (changed.length === 1 ? ' rate saved.' : ' rates saved.'),
          'good'
        );
      }
    });
  }

  function chooseKind(next) {
    kind = next;
    ['COW', 'BUFF', 'unpriced'].forEach(function (key) {
      const active = key === next;
      $('#kind-' + key)
        .toggleClass('is-active', active)
        .attr('aria-pressed', String(active));
    });
    render();
  }

  $(function () {
    if (!MaitAI.shell.requireSession()) {
      return;
    }
    MaitAI.shell.mount();
    load();

    // Delegated: the rows are re-rendered on every keystroke's worth of state, so a handler
    // bound to the inputs themselves would be lost with them.
    $('#rows').on('input', '.input--rate', function () {
      const id = $(this).data('id');
      const field = $(this).data('field');
      edits[id] = edits[id] || {};
      edits[id][field] = $(this).val();
      summarise();

      // The status pill is the only thing that changes, so the row is patched rather than the
      // table redrawn — redrawing would take the focus out of the field being typed into.
      const breed = breeds.filter(function (item) {
        return String(item.id) === String(id);
      })[0];
      if (breed) {
        $(this)
          .closest('tr')
          .find('td:last-child')
          .html(
            dirty(breed)
              ? ui.pill('Unsaved', 'warn')
              : unpriced(breed)
                ? ui.pill('Not priced', 'bad')
                : ui.pill('Priced', 'good')
          );
      }
    });

    $('#save-all').on('click', saveAll);
    $('#kind-COW').on('click', function () {
      chooseKind('COW');
    });
    $('#kind-BUFF').on('click', function () {
      chooseKind('BUFF');
    });
    $('#kind-unpriced').on('click', function () {
      chooseKind('unpriced');
    });
    $('#search').on('input', function () {
      search = $(this).val() || '';
      render();
    });
  });
})(window.MaitAI, jQuery);
