/**
 * Admin sign-in (W1).
 *
 * Maits are refused here by the API, not hidden from here by the UI. They authenticate with
 * a mobile OTP in the app, and their accounts carry no usable password — so there is nothing
 * for this form to accept even if someone tries.
 */

(function ($, MaitAI) {
  'use strict';

  const api = MaitAI.api;

  function showError(problem) {
    $('#alert-region').html(
      $('<div class="alert alert--error"></div>').text(MaitAI.api.problemToLines(problem)[0])
    );
  }

  function clearError() {
    $('#alert-region').empty();
  }

  $(function () {
    // Already signed in — skip the form rather than making someone re-enter a password they
    // have a valid session for.
    if (api.tokens.get().access) {
      window.location.replace('index.html');
      return;
    }

    const $form = $('#login-form');
    const $submit = $('#submit');
    const $label = $('#submit-label');
    const $password = $('#password');

    $('#reveal').on('click', function () {
      const revealed = $password.attr('type') === 'text';
      $password.attr('type', revealed ? 'password' : 'text');
      $(this)
        .text(revealed ? 'Show' : 'Hide')
        .attr('aria-pressed', String(!revealed));
    });

    $form.on('submit', function (event) {
      event.preventDefault();
      clearError();

      const username = $('#username').val().trim();
      const password = $password.val();

      if (!username || !password) {
        showError({ detail: 'Enter your username and password.' });
        return;
      }

      $submit.prop('disabled', true);
      $label.text('Signing in…');

      api
        .login(username, password)
        .done(function () {
          window.location.replace('index.html');
        })
        .fail(function (problem) {
          // The API returns one message for every failure — an unknown username and a wrong
          // password are deliberately indistinguishable, so nobody can enumerate accounts.
          showError(problem);
          $password.val('').trigger('focus');
        })
        .always(function () {
          $submit.prop('disabled', false);
          $label.text('Sign in');
        });
    });
  });
})(jQuery, window.MaitAI);
