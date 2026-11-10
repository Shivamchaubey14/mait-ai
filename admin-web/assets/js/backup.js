/**
 * Backup (Super Admin only).
 *
 * One action on its own screen: take a cold copy of the whole database as a ZIP. It is a screen
 * rather than a corner of another one for the same reason Mait payment is — the file leaves the
 * building with Aadhaar and bank details in it, and the account allowed to produce it is not
 * every account that can read a table.
 *
 * The whole of the wait is server-side: the archive is a zip, and a zip is not valid until its
 * central directory is written, so the server has to finish building before it can send a byte.
 * That is why the bar is indeterminate first and only becomes a fraction once bytes arrive —
 * a bar sitting at 0% for several seconds and then filling reads as broken, and it is not.
 */

(function (MaitAI, $) {
  'use strict';

  /** Put the bar back to a clean, hidden, ready-to-run state. */
  function resetProgress() {
    const $bar = $('#backup-bar');
    $bar.addClass('is-indeterminate').removeClass('is-done is-error');
    $('#backup-fill').css('width', '0%');
    $('#backup-progress').prop('hidden', true);
    $('#backup-status').text('Preparing the archive…');
  }

  function setFraction(fraction) {
    const $bar = $('#backup-bar');
    const $fill = $('#backup-fill');
    if (fraction === null || fraction === undefined) {
      // Length unknown — say "working" with a travelling stripe rather than guess a total and
      // have the bar run to the end and jump back.
      $bar.addClass('is-indeterminate');
      $fill.css('width', '30%');
      return;
    }
    $bar.removeClass('is-indeterminate');
    $fill.css('width', Math.round(fraction * 100) + '%');
  }

  function run() {
    const $btn = $('#backup-download');
    if ($btn.prop('disabled')) {
      return;
    }
    const $label = $('#backup-label');
    const original = $label.text();
    const $status = $('#backup-status');

    MaitAI.shell.clearAlert();
    $btn.prop('disabled', true).attr('aria-busy', 'true');
    $label.text('Preparing…');
    resetProgress();
    $('#backup-progress').prop('hidden', false);

    MaitAI.api
      .databaseBackup(function (progress) {
        if (progress.phase === 'preparing') {
          $('#backup-bar').addClass('is-indeterminate');
          $status.text('Building the archive on the server…');
          $label.text('Preparing…');
        } else if (progress.phase === 'receiving') {
          setFraction(progress.fraction);
          if (progress.fraction === null) {
            $status.text('Downloading…');
            $label.text('Downloading…');
          } else {
            const pct = Math.round(progress.fraction * 100);
            $status.text('Downloading… ' + pct + '%');
            $label.text(pct + '%');
          }
        } else if (progress.phase === 'done') {
          setFraction(1);
          $status.text('Saved.');
          $label.text('Saved');
        }
      })
      .then(function () {
        $('#backup-bar').removeClass('is-indeterminate').addClass('is-done');
        $('#backup-fill').css('width', '100%');
        $status.text('Backup downloaded — check your browser’s downloads folder.');
        MaitAI.shell.alert('Backup downloaded. The file is in your browser’s downloads.', 'good');
        $btn.prop('disabled', false).removeAttr('aria-busy');
        $label.text(original);
      })
      .catch(function () {
        $('#backup-bar').removeClass('is-indeterminate').addClass('is-error');
        $status.text('The backup could not be built. Nothing was downloaded.');
        MaitAI.shell.alert(
          'The backup could not be built. Nothing was downloaded — try again.',
          'bad'
        );
        $btn.prop('disabled', false).removeAttr('aria-busy');
        $label.text(original);
      });
  }

  $(function () {
    if (!MaitAI.shell.requireSession()) {
      return;
    }
    MaitAI.shell.mount();
    $('#backup-download').on('click', run);
  });
})(window.MaitAI, jQuery);
