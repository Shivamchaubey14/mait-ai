/**
 * The photo viewer, shared by every screen that shows one.
 *
 * A `<dialog>` rather than a div with a scrim, because the browser already knows how to do
 * this properly: Escape closes it, focus is trapped inside it, focus returns to whatever
 * opened it, and everything behind is marked inert for a screen reader without a line of
 * script. None of that is worth reimplementing and all of it is worth having on a page that
 * renders identity documents.
 *
 * **It owns its own markup.** The dialog is built on first use and reused afterwards, so a
 * screen adopting this pastes no HTML — the AI event screen still carries thirty lines of its
 * own, which is exactly what a second page copying them would turn into two viewers drifting
 * apart. That screen predates this module and has not been moved onto it yet; it should be.
 * No third-party script either way, per the README's rule for pages that render PII.
 *
 * **It takes a list, not an image.** A card has a front and a back, and a farmer has as many
 * payment screenshots as she has paid online. Somebody checking a number against a card wants
 * to turn it over, not close the viewer and hunt for the other well.
 *
 * **It zooms**, which is the part that earns it. These wells are a third of a screen wide and
 * the job on this page is reading twelve digits off a photograph — a viewer that only scales a
 * picture to fit the window has not replaced opening the file in a tab, it has just moved the
 * squinting. Fit-to-window on open, one click to actual size, drag to pan.
 */

window.MaitAI = window.MaitAI || {};

(function (MaitAI, $) {
  'use strict';

  //: Built once, on first open. Kept afterwards — a dialog is cheap to leave in the document
  //: and rebuilding it would lose the browser's own focus bookkeeping.
  let dialog = null;

  //: What is being shown: the list, where we are in it, and whether we are zoomed.
  const state = { items: [], index: 0, zoomed: false };

  const ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';

  function build() {
    dialog = document.createElement('dialog');
    dialog.className = 'lightbox';
    dialog.id = 'lightbox';
    dialog.setAttribute('aria-labelledby', 'lightbox-title');
    dialog.innerHTML =
      '<h2 class="visually-hidden" id="lightbox-title">Photograph, full size</h2>' +
      '<button class="lightbox__close" type="button" data-lb="close" ' +
      'aria-label="Close the photo">' +
      ICON +
      '<path d="M18 6 6 18M6 6l12 12" /></svg></button>' +
      '<button class="lightbox__step lightbox__step--prev" type="button" data-lb="prev" ' +
      'aria-label="Previous photo">' +
      ICON +
      '<path d="M15 18 9 12l6-6" /></svg></button>' +
      '<button class="lightbox__step lightbox__step--next" type="button" data-lb="next" ' +
      'aria-label="Next photo">' +
      ICON +
      '<path d="m9 6 6 6-6 6" /></svg></button>' +
      '<div class="lightbox__stage" data-lb="stage"></div>' +
      '<p class="lightbox__caption"><span data-lb="caption"></span>' +
      '<span class="lightbox__count" data-lb="count"></span>' +
      '<span class="lightbox__hint" data-lb="hint"></span></p>';
    document.body.appendChild(dialog);
    bind();
  }

  /** The one currently on screen. */
  function current() {
    return state.items[state.index] || {};
  }

  /**
   * Draw the current item.
   *
   * The `<img>` is replaced rather than re-`src`-ed, so a large photograph that is still
   * decoding cannot be seen briefly under the caption of the one after it.
   */
  function render() {
    const item = current();
    const many = state.items.length > 1;

    // Held open at a workable size until the picture arrives. These are handset photographs at
    // full resolution, several megabytes each, and an `<img>` with nothing decoded yet measures
    // zero — so without this the dialog opens as a 350px sliver of caption and then snaps to
    // full size a second later, which looks like a misfire rather than a photo loading.
    const $stage = $(dialog).find('[data-lb="stage"]').addClass('is-loading').empty();

    const $image = $('<img>')
      .addClass('lightbox__image')
      .attr({
        // Named rather than described. An operator on a screen reader is checking that a
        // photograph exists and is theirs to look at, not being told what a card looks
        // like — and the number itself is never put in alt text.
        alt: item.alt || '',
        decoding: 'async',
      })
      .on('load error', function () {
        // `error` too: a photograph the server will not serve should give the frame back
        // rather than leave the viewer holding an empty box that says it is still loading.
        $stage.removeClass('is-loading');
      });

    // `src` after the handlers, or a cached image can finish before they are attached and the
    // stage is left saying "loading" over a picture that is already there.
    $stage.append($image);
    $image.attr('src', item.src);

    $(dialog)
      .find('[data-lb="caption"]')
      .text(item.caption || item.alt || '');
    $(dialog)
      .find('[data-lb="count"]')
      .text(many ? state.index + 1 + ' of ' + state.items.length : '');
    $(dialog)
      .find('[data-lb="hint"]')
      .text(state.zoomed ? 'Click the photo to fit it to the window' : 'Click the photo to zoom');

    // Hidden rather than disabled at the ends: this wraps, because two faces of one card are a
    // pair somebody flips between rather than a list they walk off the end of.
    $(dialog).find('[data-lb="prev"],[data-lb="next"]').prop('hidden', !many);
    setZoom(false);
  }

  /**
   * Actual size, or fit to the window.
   *
   * Zoomed, the stage scrolls and the image is left at its natural size; fitted, the image is
   * bounded by the viewport. The class does the work so there is one definition of each state
   * rather than a pile of inline styles to undo.
   */
  function setZoom(on) {
    state.zoomed = !!on;
    $(dialog).toggleClass('lightbox--zoomed', state.zoomed);
    $(dialog)
      .find('[data-lb="hint"]')
      .text(state.zoomed ? 'Click the photo to fit it to the window' : 'Click the photo to zoom');
    if (!state.zoomed) {
      const stage = dialog.querySelector('[data-lb="stage"]');
      if (stage) {
        stage.scrollTop = 0;
        stage.scrollLeft = 0;
      }
    }
  }

  function step(by) {
    if (state.items.length < 2) {
      return;
    }
    const count = state.items.length;
    state.index = (state.index + by + count) % count;
    render();
  }

  /**
   * Drag to pan while zoomed.
   *
   * Pointer events rather than mouse events, so a trackpad, a pen and a touchscreen all work
   * from one path. Capture keeps the drag alive when the pointer leaves the stage mid-move,
   * which is most drags — the whole point is that the picture is bigger than the box.
   */
  function bindPan($stage) {
    let from = null;

    $stage.on('pointerdown.lb', function (e) {
      if (!state.zoomed) {
        return;
      }
      const stage = this;
      from = { x: e.clientX, y: e.clientY, left: stage.scrollLeft, top: stage.scrollTop };
      stage.setPointerCapture(e.pointerId);
      $stage.addClass('is-panning');
      // Or the browser starts its own image drag and the pan turns into a drag-and-drop.
      e.preventDefault();
    });

    $stage.on('pointermove.lb', function (e) {
      if (!from) {
        return;
      }
      this.scrollLeft = from.left - (e.clientX - from.x);
      this.scrollTop = from.top - (e.clientY - from.y);
    });

    $stage.on('pointerup.lb pointercancel.lb', function (e) {
      if (!from) {
        return;
      }
      // A press that never moved is a click asking to zoom back out, not a pan.
      const moved = Math.abs(e.clientX - from.x) > 3 || Math.abs(e.clientY - from.y) > 3;
      from = null;
      $stage.removeClass('is-panning');
      if (!moved) {
        setZoom(false);
      }
    });
  }

  function bind() {
    const $dialog = $(dialog);
    const $stage = $dialog.find('[data-lb="stage"]');

    $dialog.on('click.lb', '[data-lb="close"]', function () {
      dialog.close();
    });
    $dialog.on('click.lb', '[data-lb="prev"]', function () {
      step(-1);
    });
    $dialog.on('click.lb', '[data-lb="next"]', function () {
      step(1);
    });

    // Zoom in on a plain click; zooming out is handled by the pan release, which is the same
    // gesture and has to tell a click from a drag.
    $stage.on('click.lb', '.lightbox__image', function () {
      if (!state.zoomed) {
        setZoom(true);
      }
    });
    bindPan($stage);

    $dialog.on('keydown.lb', function (e) {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        step(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        step(1);
      } else if (e.key === 'Enter' || e.key === ' ') {
        // Only when the focus is not on one of the dialog's own buttons, which answer to
        // these keys themselves and would otherwise fire twice.
        if (!$(e.target).is('button')) {
          e.preventDefault();
          setZoom(!state.zoomed);
        }
      }
    });

    /**
     * Clicking the dark area closes it.
     *
     * A click on a dialog's backdrop is dispatched to the dialog element itself — there is no
     * node to bind to — so this asks where the click landed rather than what it hit. Testing
     * `e.target === dialog` would work for the backdrop but would also fire on the dialog's
     * own padding, and it cannot tell the two apart; the pointer's position can.
     */
    $dialog.on('click.lb', function (e) {
      if (e.target !== dialog) {
        return;
      }
      const r = dialog.getBoundingClientRect();
      const outside =
        e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      if (outside) {
        dialog.close();
      }
    });

    // Leave nothing loaded behind a closed dialog: these are identity documents and payment
    // screens, and a decoded copy sitting in a hidden node is one more place they exist.
    $dialog.on('close.lb', function () {
      $stage.empty();
      state.items = [];
    });
  }

  MaitAI.lightbox = {
    /**
     * Show `items` — `[{ src, alt, caption }]` — starting at `index`.
     *
     * Silently does nothing for an empty list, so a caller can hand over whatever photographs
     * a record happens to have without checking first.
     */
    open: function (items, index) {
      const list = (items || []).filter(function (item) {
        return item && item.src;
      });
      if (!list.length) {
        return;
      }
      if (!dialog) {
        build();
      }
      state.items = list;
      state.index = Math.min(Math.max(index || 0, 0), list.length - 1);
      render();
      // `showModal`, not `show`: it is what puts the page behind it inert and gives Escape its
      // meaning. Guarded because a dialog already open throws on a second call.
      if (!dialog.open) {
        dialog.showModal();
      }
    },
  };
})(window.MaitAI, jQuery);
