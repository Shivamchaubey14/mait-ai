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

  function row(user) {
    return (
      '<tr' +
      (user.is_active ? '' : ' class="is-blocked"') +
      '>' +
      '<td>' +
      ui.identity(user.full_name, user.email) +
      '</td>' +
      '<td><span class="table__code">' +
      ui.escapeHtml(user.username) +
      '</span></td>' +
      '<td>' +
      ui.escapeHtml(user.role_display) +
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
      ' <button class="btn" type="button" data-toggle="' +
      user.id +
      '" data-active="' +
      user.is_active +
      '">' +
      (user.is_active ? 'Deactivate' : 'Reactivate') +
      '</button>' +
      '</td>' +
      '</tr>'
    );
  }

  function load() {
    MaitAI.shell.clearAlert();
    MaitAI.api
      .users({ limit: LIMIT, offset: state.offset })
      .done(function (page) {
        $('#user-count').text(ui.number(page.count));
        ui.rows($('#rows'), page.results, row, 'No portal accounts yet.', 6);
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
        ui.rows($('#rows'), [], row, 'Could not load accounts.', 6);
      });
  }

  $(function () {
    if (!MaitAI.shell.requireSession()) {
      return;
    }
    MaitAI.shell.mount();
    load();

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

    $('#rows').on('click', '[data-toggle]', function () {
      const $button = $(this);
      const id = $button.data('toggle');
      const nowActive = String($button.data('active')) !== 'true';

      MaitAI.api
        .updateUser(id, { is_active: nowActive })
        .done(load)
        .fail(function (problem) {
          MaitAI.shell.alert(problem.detail);
        });
    });
  });
})(window.MaitAI, jQuery);
