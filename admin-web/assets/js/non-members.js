/**
 * Non-members list (W10b).
 *
 * The sibling of the Members screen, and deliberately not the same screen. Members arrive
 * from SAP in their hundreds of thousands, already checked, and nobody browses them — that
 * screen is search-first and says almost nothing about each row. These arrive one at a time,
 * typed by a Mait standing in a yard, and the path they belong to is the only one in the
 * product that ends with cash changing hands. So this screen is a review queue: it is browsed,
 * newest first, and every column is there to let a row be judged without opening it.
 *
 * The two columns that matter are Aadhaar and consent. A registration with neither is a
 * farmer nobody can check against anything and who never agreed to be on file, and the
 * headline tiles count exactly those — a queue an operator can work down rather than a total
 * they can only nod at.
 */

(function (MaitAI, $) {
  'use strict';

  const ui = MaitAI.ui;
  const LIMIT = 25;

  const state = { offset: 0, noCard: false };

  /**
   * Whose name that is, spelled out.
   *
   * `father_husband_name` has carried both since SAP, so the name alone does not say whether
   * this is her father or her husband — and "Sunita w/o Ram" and "Sunita d/o Ram" are two
   * different women in a village where the same names repeat. Rows registered before the app
   * asked carry neither, and say so rather than guessing.
   */
  function household(row) {
    if (!row.father_husband_name) {
      return 'Household not recorded';
    }
    const relation = row.relation_display || 'Father / husband';
    return relation + ': ' + row.father_husband_name;
  }

  /**
   * The card, as a pill that names the gap rather than only flagging it.
   *
   * "Missing" and "Back only" need different actions from the back office — one is a
   * registration to redo, the other a photograph to chase — so they are not collapsed into a
   * single red word.
   */
  function cardCell(row) {
    if (row.aadhar_front_captured && row.aadhar_back_captured) {
      return ui.pill('On file', 'good');
    }
    if (row.aadhar_front_captured) {
      return ui.pill('Front only', 'warn');
    }
    if (row.aadhar_back_captured) {
      return ui.pill('Back only', 'warn');
    }
    return ui.pill('Missing', 'bad');
  }

  function mobileCell(row) {
    if (!row.mobile_no) {
      // She cannot be sent a payment code, so her Mait cannot close an event for her.
      return '<span class="table__sub">No number</span>';
    }
    return ui.escapeHtml(row.mobile_no);
  }

  function row(item) {
    // Tinted when there is nothing to check the row against, so a screenful is triaged
    // without reading every Aadhaar cell — the same language the other rosters use.
    const noCard = !item.aadhar_front_captured || !item.aadhar_back_captured;
    const rowClass = !item.consent_captured_at
      ? ' class="is-blocked"'
      : noCard
        ? ' class="is-waiting"'
        : '';

    return (
      '<tr' +
      rowClass +
      '>' +
      '<td>' +
      '<a class="table__name table__name--link" href="non-member.html?id=' +
      encodeURIComponent(item.id) +
      '">' +
      ui.escapeHtml(item.name || '—') +
      '</a>' +
      '<span class="table__sub">' +
      ui.escapeHtml(household(item)) +
      '</span>' +
      '</td>' +
      '<td>' +
      mobileCell(item) +
      '</td>' +
      '<td>' +
      ui.identity(item.mpp_name || '—', item.mpp_code) +
      '</td>' +
      '<td>' +
      ui.identity(item.registered_by || '—', item.registered_by_code) +
      '</td>' +
      '<td class="table__num">' +
      ui.number(item.animal_count) +
      '</td>' +
      '<td class="table__num">' +
      ui.number(item.ai_event_count) +
      '</td>' +
      '<td>' +
      cardCell(item) +
      '</td>' +
      '<td>' +
      ui.dateTime(item.created_at) +
      '</td>' +
      '</tr>'
    );
  }

  function query() {
    const params = { limit: LIMIT, offset: state.offset };
    const search = ($('#search').val() || '').trim();
    const mpp = $('#filter-mpp').val();

    if (search) {
      params.search = search;
    }
    if (mpp) {
      params.mpp__mpp_code = mpp;
    }
    if (state.noCard) {
      params.no_card = true;
    }
    return params;
  }

  /**
   * The tiles summarise the page, and say so.
   *
   * Only `count` is a true total — the rest are counted from the rows in hand, because the API
   * pages. Labelling them as the page's own figures is the honest answer; a tile claiming to
   * count the whole population from twenty-five rows would be wrong by two orders of magnitude
   * on the first day the table fills up.
   */
  function summarise(page) {
    const rows = page.results || [];
    const noCard = rows.filter(function (r) {
      return !r.aadhar_front_captured || !r.aadhar_back_captured;
    }).length;
    const noConsent = rows.filter(function (r) {
      return !r.consent_captured_at;
    }).length;
    const events = rows.reduce(function (sum, r) {
      return sum + (r.ai_event_count || 0);
    }, 0);

    $('#total-value').text(ui.number(page.count));
    $('#no-card-value').text(ui.number(noCard));
    $('#no-consent-value').text(ui.number(noConsent));
    $('#events-value').text(ui.number(events));

    // A clean page should not wear the alarm colours. Yellow that is always on stops being
    // read, and then it is not there on the day it means something.
    $('#tile-no-card').toggleClass('tile--bad', noCard > 0);
    $('#no-card-foot')
      .toggleClass('tile__foot--bad', noCard > 0)
      .text(noCard ? 'Nothing to check against' : 'Every card on this page is on file');
    $('#tile-no-consent').toggleClass('tile--warn', noConsent > 0);
  }

  function load() {
    MaitAI.shell.clearAlert();
    MaitAI.api
      .nonMembers(query())
      .done(function (page) {
        $('#non-member-count').text(ui.number(page.count) + ' farmers');
        summarise(page);
        ui.rows(
          $('#rows'),
          page.results,
          row,
          state.noCard
            ? 'Every non-member on file has both faces of their card.'
            : 'No non-members match that search.',
          8
        );
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
        ui.rows($('#rows'), [], row, 'Could not load non-members.', 8);
      });
  }

  function loadMppOptions() {
    MaitAI.api.mpps({ limit: 200 }).done(function (page) {
      $('#filter-mpp').append(
        (page.results || [])
          .map(function (mpp) {
            return (
              '<option value="' +
              ui.escapeHtml(mpp.mpp_code) +
              '">' +
              ui.escapeHtml(mpp.mpp_name) +
              '</option>'
            );
          })
          .join('')
      );
      // No refresh call: the replacement control watches the native select for appended
      // options (controls.js), which is exactly this case — the MPP list is fetched.
    });
  }

  $(function () {
    if (!MaitAI.shell.requireSession()) {
      return;
    }
    MaitAI.shell.mount();

    // Deep-linked from anywhere that counts these — the filter travels in the URL so the link
    // is shareable and survives a refresh.
    if (MaitAI.shell.param('no_card') === 'true') {
      state.noCard = true;
      $('#filter-no-card').addClass('is-active').attr('aria-pressed', 'true');
    }

    loadMppOptions();
    load();

    let debounce = null;
    $('#search').on('input', function () {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(function () {
        state.offset = 0;
        load();
      }, 350);
    });

    $('#filter-mpp').on('change', function () {
      state.offset = 0;
      load();
    });

    $('#filter-no-card').on('click', function () {
      state.noCard = !state.noCard;
      state.offset = 0;
      $(this).toggleClass('is-active', state.noCard).attr('aria-pressed', String(state.noCard));
      load();
    });
  });
})(window.MaitAI, jQuery);
