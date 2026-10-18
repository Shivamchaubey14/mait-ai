/**
 * Admin password reset (W1a).
 *
 * A two-step flow on one page: ask for a one-time code by username, then type the code and a
 * new password. The code is sent to the number already on the account — the page never asks
 * for a number — so a reset cannot be aimed at a phone the account holder does not hold.
 *
 * Maits are not served here at all: they sign in by OTP in the app and their accounts carry no
 * usable password. The server refuses them; this page simply never mentions them.
 *
 * The request step always succeeds the same way whether or not the username was real — that is
 * deliberate on the server, so account names cannot be probed. This page therefore moves to the
 * code step on any username, and it is the code step that tells a real account from an invented
 * one, by whether a code ever arrives.
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

  function step(name) {
    $('#step-request, #step-verify, #step-done').attr('hidden', true);
    $('#step-' + name).removeAttr('hidden');
  }

  $(function () {
    const $username = $('#username');
    const $otp = $('#otp');
    const $newPassword = $('#new-password');
    const $confirm = $('#confirm-password');

    const $requestSubmit = $('#request-submit');
    const $requestLabel = $('#request-label');
    const $verifySubmit = $('#verify-submit');
    const $verifyLabel = $('#verify-label');

    $username.trigger('focus');

    // Reveal the new password, for the same reason the sign-in form does: a mistyped password
    // on a shared office machine is the likeliest way to burn an attempt. Confirm follows it,
    // so the two are checked against each other in the open or not at all.
    $('#reveal').on('click', function () {
      const revealed = $newPassword.attr('type') === 'text';
      const type = revealed ? 'password' : 'text';
      $newPassword.attr('type', type);
      $confirm.attr('type', type);
      $(this)
        .text(revealed ? 'Show' : 'Hide')
        .attr('aria-pressed', String(!revealed));
    });

    $('#back').on('click', function () {
      clearError();
      step('request');
      $username.trigger('focus');
    });

    function sendCode() {
      clearError();
      const username = $username.val().trim();
      if (!username) {
        showError({ detail: 'Enter your username.' });
        return;
      }

      $requestSubmit.prop('disabled', true);
      $requestLabel.text('Sending…');

      api
        .requestPasswordReset(username)
        .done(function () {
          step('verify');
          $otp.val('').trigger('focus');
        })
        .fail(showError)
        .always(function () {
          $requestSubmit.prop('disabled', false);
          $requestLabel.text('Send code');
        });
    }

    function resetPassword() {
      clearError();
      const username = $username.val().trim();
      const otp = $otp.val().trim();
      const newPassword = $newPassword.val();
      const confirm = $confirm.val();

      if (!otp) {
        showError({ detail: 'Enter the one-time code sent to your mobile.' });
        return;
      }
      if (newPassword.length < 10) {
        showError({ detail: 'Your new password must be at least 10 characters.' });
        return;
      }
      if (newPassword !== confirm) {
        showError({ detail: 'The two passwords do not match.' });
        $confirm.val('').trigger('focus');
        return;
      }

      $verifySubmit.prop('disabled', true);
      $verifyLabel.text('Resetting…');

      api
        .resetPassword(username, otp, newPassword)
        .done(function () {
          step('done');
        })
        .fail(function (problem) {
          // A wrong or expired code, or a password the server rejected. The field errors carry
          // the server's own wording; clear the code so the next try starts clean.
          showError(problem);
          $otp.trigger('focus').select();
        })
        .always(function () {
          $verifySubmit.prop('disabled', false);
          $verifyLabel.text('Reset password');
        });
    }

    // One form, two live steps — route Enter and the button to whichever is on screen.
    $('#reset-form').on('submit', function (event) {
      event.preventDefault();
      if (!$('#step-verify').attr('hidden')) {
        resetPassword();
      } else if (!$('#step-request').attr('hidden')) {
        sendCode();
      }
    });
  });
})(jQuery, window.MaitAI);
