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

  const state = { offset: 0 };

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
        $('#user-count').text(ui.number(page.count));
        ui.rows(
          $('#rows'),
          page.results,
          row,
          ($('#search').val() || '').trim() || $('#filter-role').val()
            ? 'No account matches those filters.'
            : 'No portal accounts yet.',
          7
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
        ui.rows($('#rows'), [], row, 'Could not load accounts.', 7);
        countActive();
      });
  }

  $(function () {
    if (!MaitAI.shell.requireSession()) {
      return;
    }
    MaitAI.shell.mount();
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
        })
        .done(function () {
          $('#create-form')[0].reset();
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
          $('[data-user="' + id + '"]').replaceWith(row(user));
          countActive();
        })
        .fail(function (problem) {
          $button.prop('disabled', false).removeClass('is-working').text(label);
          MaitAI.shell.alert(problem.detail);
        });
    });
  });
})(window.MaitAI, jQuery);
