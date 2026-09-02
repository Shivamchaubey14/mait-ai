/**
 * API client for the admin portal (SRS §9).
 *
 * Thin wrapper over jQuery AJAX. Every request goes through here so authentication, token
 * refresh and error shaping exist in exactly one place — a `$.ajax` call sprinkled into a
 * page would miss all three.
 */

window.MaitAI = window.MaitAI || {};

(function (MaitAI, $) {
  'use strict';

  /**
   * Where the API lives.
   *
   * Deployed, nginx serves the portal and the API from one origin, so a relative path is
   * correct and avoids baking a hostname into the build. On the no-Docker development path
   * the portal is static-served on 8080 while Django runs on 8000 — a relative path there
   * asks the file server for `/api/v1` and gets a 404 that looks like a broken portal.
   *
   * Dev settings enable CORS for exactly this. Set `window.MAITAI_API_BASE` before this
   * script to point somewhere else.
   */
  const BASE_URL = (function () {
    if (window.MAITAI_API_BASE) {
      return window.MAITAI_API_BASE;
    }
    const port = window.location.port;
    if (port && port !== '80' && port !== '443' && port !== '8000') {
      return window.location.protocol + '//' + window.location.hostname + ':8000/api/v1';
    }
    return '/api/v1';
  })();

  const STORAGE_KEY = 'maitai.tokens';
  const PROFILE_KEY = 'maitai.profile';

  /* --- token storage ------------------------------------------------------------------
   * sessionStorage, not localStorage: back-office machines are shared, and a token that
   * survives closing the browser is a token someone else can use.
   */
  const tokens = {
    get() {
      try {
        return JSON.parse(sessionStorage.getItem(STORAGE_KEY)) || {};
      } catch (e) {
        return {};
      }
    },
    set(value) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    },
    clear() {
      sessionStorage.removeItem(STORAGE_KEY);
      // The profile goes with them. It says which sections this account may open, and one
      // left behind would draw the last person's sidebar for the next person to sign in.
      sessionStorage.removeItem(PROFILE_KEY);
    },
  };

  /* --- who is signed in ----------------------------------------------------------------
   * The portal is one static file per screen, so without this every page would have to ask
   * the API who it is serving before it could draw its own sidebar — and would draw the
   * wrong one, or none, for as long as that took.
   *
   * A convenience and never a control. Each section's endpoints check access for themselves,
   * because a menu has nothing to say about a URL typed into the address bar.
   */
  const profile = {
    get() {
      try {
        return JSON.parse(sessionStorage.getItem(PROFILE_KEY));
      } catch (e) {
        return null;
      }
    },
    set(value) {
      if (!value) {
        return null;
      }
      // Only the parts a screen actually draws. The rest of `/auth/me/` is a Mait's scope,
      // which no portal screen reads.
      const kept = {
        id: value.id,
        username: value.username,
        full_name: value.full_name,
        role: value.role,
        role_display: value.role_display,
        portal_sections: value.portal_sections || [],
      };
      sessionStorage.setItem(PROFILE_KEY, JSON.stringify(kept));
      return kept;
    },
    clear() {
      sessionStorage.removeItem(PROFILE_KEY);
    },
  };

  /* --- errors -------------------------------------------------------------------------
   * The API speaks RFC 7807 (SRS §9.11). Normalise once so callers never parse jqXHR.
   */
  function toProblem(jqXHR) {
    const fallback = {
      type: 'about:blank',
      title: 'Request failed',
      status: jqXHR.status || 0,
      detail:
        jqXHR.status === 0
          ? 'Could not reach the server. Check your connection.'
          : 'Something went wrong. Please try again.',
      errors: {},
    };
    try {
      return Object.assign(fallback, JSON.parse(jqXHR.responseText));
    } catch (e) {
      return fallback;
    }
  }

  /** Flatten field errors into lines suitable for a form summary. */
  function problemToLines(problem) {
    const lines = [];
    Object.keys(problem.errors || {}).forEach(function (field) {
      (problem.errors[field] || []).forEach(function (message) {
        lines.push(field === 'non_field_errors' ? message : field + ': ' + message);
      });
    });
    return lines.length ? lines : [problem.detail];
  }

  /* --- transport ---------------------------------------------------------------------- */

  let refreshInFlight = null;

  function refreshAccessToken() {
    // Deduplicated: a dashboard fires several requests at once, and without this every one
    // of them would kick off its own refresh and invalidate the others' new token.
    if (refreshInFlight) {
      return refreshInFlight;
    }
    const stored = tokens.get();
    if (!stored.refresh) {
      return $.Deferred().reject().promise();
    }

    refreshInFlight = $.ajax({
      url: BASE_URL + '/auth/refresh/',
      method: 'POST',
      contentType: 'application/json',
      // This call does not go through `request`, so it needs the tunnel header of its own —
      // see `settings.beforeSend` below. Without it a session behind ngrok survives exactly
      // one access token and then bounces the operator to login every fifteen minutes.
      headers: { 'ngrok-skip-browser-warning': 'true' },
      data: JSON.stringify({ refresh: stored.refresh }),
    })
      .done(function (data) {
        tokens.set({ access: data.access, refresh: data.refresh || stored.refresh });
      })
      .always(function () {
        refreshInFlight = null;
      });

    return refreshInFlight;
  }

  function request(options) {
    const settings = $.extend(
      {
        url: BASE_URL + options.path,
        method: options.method || 'GET',
        dataType: 'json',
      },
      options.ajax || {}
    );

    if (options.body !== undefined && !(options.body instanceof FormData)) {
      settings.contentType = 'application/json';
      settings.data = JSON.stringify(options.body);
    } else if (options.body instanceof FormData) {
      settings.contentType = false;
      settings.processData = false;
      settings.data = options.body;
    }

    if (options.query) {
      settings.url += '?' + $.param(options.query);
    }

    settings.beforeSend = function (xhr) {
      const access = tokens.get().access;
      if (access) {
        xhr.setRequestHeader('Authorization', 'Bearer ' + access);
      }
      // Harmless everywhere, and the difference between working and not when the portal is
      // reached through an ngrok tunnel — which is how somebody off this network opens it.
      // Without it ngrok's free tier answers anything browser-shaped with an HTML
      // interstitial, which arrives here as a JSON parse failure and reads, on every screen
      // at once, as the server being down. mobile/src/api/client.ts carries the same header
      // for the same reason.
      xhr.setRequestHeader('ngrok-skip-browser-warning', 'true');
    };

    return $.ajax(settings).catch(function (jqXHR) {
      // Access tokens last ~15 minutes (SRS §16), so expiry mid-session is routine.
      // Retry once; a second failure means the refresh token is gone too.
      if (jqXHR.status === 401 && !options._retried) {
        return refreshAccessToken().then(
          function () {
            return request($.extend({}, options, { _retried: true }));
          },
          function () {
            tokens.clear();
            // Relative, so the portal works when it is not served from the domain root.
            window.location.href = 'login.html';
            return $.Deferred().reject(toProblem(jqXHR)).promise();
          }
        );
      }
      return $.Deferred().reject(toProblem(jqXHR)).promise();
    });
  }

  /**
   * ajax options for sending a file, reporting the transfer as it goes.
   *
   * Shared by every upload rather than written out per endpoint: the seconds a 28 MB workbook
   * spends on an office line are seconds the operator is looking at a card that says nothing,
   * and one of the two upload calls having a progress hook was simply an oversight.
   */
  function sending(onProgress) {
    return {
      xhr: function () {
        const xhr = new window.XMLHttpRequest();
        if (typeof onProgress === 'function') {
          xhr.upload.addEventListener('progress', function (event) {
            if (event.lengthComputable) {
              onProgress(Math.round((event.loaded / event.total) * 100));
            }
          });
        }
        return xhr;
      },
      timeout: 0, // a 28 MB upload on a slow office line must not be cut off
    };
  }

  /**
   * Read a response body through, reporting how far along it is.
   *
   * `response.blob()` resolves once, at the end, which is a spinner however it is drawn. The
   * body is a stream, so it can be read chunk by chunk and measured against `Content-Length`.
   *
   * Falls back to `blob()` untouched wherever the browser has no readable stream or the
   * server sent no length. The caller is told the length is unknown rather than handed a
   * made-up fraction: "unknown" is a state a bar can draw honestly and a wrong number is not.
   */
  function measured(response, onProgress) {
    const total = Number(response.headers.get('Content-Length'));
    if (!response.body || !response.body.getReader || !total) {
      onProgress({ phase: 'receiving', fraction: null });
      return response.blob();
    }

    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;

    const pump = function () {
      return reader.read().then(function (result) {
        if (result.done) {
          return new Blob(chunks, { type: response.headers.get('Content-Type') || '' });
        }
        chunks.push(result.value);
        received += result.value.length;
        // Clamped: a gzipped response reports the compressed length in the header and the
        // decompressed length through the reader, which otherwise walks the bar past 100%.
        onProgress({ phase: 'receiving', fraction: Math.min(1, received / total) });
        return pump();
      });
    };

    onProgress({ phase: 'receiving', fraction: 0 });
    return pump();
  }

  /* --- public surface ------------------------------------------------------------------
   * Mirrors docs/API_CONTRACT.md. Keep it in step — the contract is frozen, and a client
   * that drifts from it fails in production rather than in review.
   */
  MaitAI.api = {
    tokens: tokens,
    profile: profile,
    problemToLines: problemToLines,

    /** Exposed for the callers that stream a file and cannot go through request(). */
    baseUrl: function () {
      return BASE_URL;
    },

    /**
     * Fetch an export and hand it to the browser as a file.
     *
     * Not a plain link. These endpoints stream and they need the bearer token, and an
     * `<a href>` arrives unauthenticated — which bounces the operator to the login screen
     * with no explanation and no file. So the blob is fetched, wrapped in an object URL and
     * clicked programmatically.
     *
     * Lives here rather than on a screen because two screens export now, and a download that
     * forgets its `Authorization` header on one of them is a bug nobody sees until an admin
     * needs the file.
     *
     * Returns a promise that rejects on a non-2xx, so the caller owns the wording of the
     * failure — "try a narrower date range" is true of one export and not of the other.
     *
     * `onProgress` is optional and receives `{ phase, fraction }`:
     *
     *   `preparing`  the request is out and nothing has come back. On these endpoints that is
     *                where most of the wait lives — an xlsx is a zip and cannot be valid until
     *                its central directory is written, so the server has to finish building
     *                before it can send a byte. Reported as its own phase because a bar sitting
     *                at 0% for four seconds and then filling looks broken, and it is not.
     *   `receiving`  bytes arriving. `fraction` is 0–1, or `null` where no `Content-Length`
     *                came back — a streamed export cannot send one, it has not finished
     *                counting. Guessing a total and then revising it is what makes a bar run
     *                to the end and jump back.
     *   `done`       the file is in hand.
     */
    download: function (path, filename, onProgress) {
      if (onProgress) {
        onProgress({ phase: 'preparing', fraction: null });
      }
      return fetch(BASE_URL + path, {
        headers: {
          Authorization: 'Bearer ' + tokens.get().access,
          // fetch, not $.ajax, so the tunnel header is repeated here — an export that came
          // back as ngrok's interstitial would save a page of HTML named report.csv.
          'ngrok-skip-browser-warning': 'true',
        },
      })
        .then(function (response) {
          if (!response.ok) {
            throw new Error('export failed: ' + response.status);
          }
          return onProgress ? measured(response, onProgress) : response.blob();
        })
        .then(function (blob) {
          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(link.href);
          if (onProgress) {
            onProgress({ phase: 'done', fraction: 1 });
          }
        });
    },

    /**
     * Resolve a media path the API returned into a URL the browser can actually fetch.
     *
     * `ai_photo_url` comes back root-relative — `/media/ai-photos/…` — which is correct
     * behind nginx, where the portal and the API share an origin. On the no-Docker
     * development path the portal is static-served on 8080, so the browser asked the file
     * server for the photo and got a 404: the proof photo, the one thing the event detail
     * screen exists to show, rendered as a broken-image glyph on a dark box.
     *
     * Absolute URLs pass through untouched — in production the photos are signed S3 links,
     * and prefixing one with an origin would break it.
     */
    mediaUrl: function (path) {
      if (!path) {
        return '';
      }
      if (/^(https?:)?\/\//i.test(path)) {
        return path;
      }
      const origin = BASE_URL.replace(/\/api\/v1\/?$/, '');
      return origin + (path.charAt(0) === '/' ? '' : '/') + path;
    },

    login: function (username, password) {
      return request({
        path: '/auth/login/',
        method: 'POST',
        body: { username: username, password: password },
      }).then(function (data) {
        tokens.set({ access: data.access, refresh: data.refresh });
        return data;
      });
    },

    logout: function () {
      const stored = tokens.get();
      return request({
        path: '/auth/logout/',
        method: 'POST',
        body: { refresh: stored.refresh },
      }).always(function () {
        tokens.clear();
      });
    },

    /** The signed-in account, including the portal sections it may open. */
    me: function () {
      return request({ path: '/auth/me/' }).then(function (data) {
        profile.set(data);
        return data;
      });
    },

    /** Every section an account can be given — what the access editor lists. */
    portalSections: function () {
      return request({ path: '/admin/users/portal-sections/' });
    },

    /**
     * Upload a SAP master file.
     *
     * Returns as soon as the job is queued — the Member Master is 100k+ rows and is parsed
     * asynchronously (SRS §6.1.6). Poll `uploadStatus` for progress rather than waiting.
     */
    uploadMaster: function (type, file, onProgress) {
      const form = new FormData();
      form.append('file', file);
      return request({
        path: '/admin/uploads/' + type + '/',
        method: 'POST',
        body: form,
        ajax: sending(onProgress),
      });
    },

    uploadStatus: function (id) {
      return request({ path: '/admin/uploads/' + id + '/' });
    },

    uploadHistory: function (query) {
      return request({ path: '/admin/uploads/', query: query });
    },

    dashboardSummary: function () {
      return request({ path: '/dashboard/summary/' });
    },

    dashboardTrends: function (query) {
      return request({ path: '/dashboard/trends/', query: query });
    },

    maitPerformance: function (query) {
      return request({ path: '/dashboard/mait-performance/', query: query });
    },

    mppCoverage: function (query) {
      return request({ path: '/dashboard/mpp-coverage/', query: query });
    },

    uploadErrors: function (id, query) {
      return request({ path: '/admin/uploads/' + id + '/errors/', query: query });
    },

    aiEvents: function (query) {
      return request({ path: '/ai-events/', query: query });
    },

    aiEvent: function (id) {
      return request({ path: '/ai-events/' + id + '/' });
    },

    /** The step-by-step trail a dispute is settled from (SRS §9.6). */
    aiEventTimeline: function (id) {
      return request({ path: '/ai-events/' + id + '/timeline/' });
    },

    /**
     * Maits from SAP who have no mobile number and so cannot sign in.
     *
     * 93% of the roster arrives in this state, which is why activation is a screen of its
     * own rather than a field on a user form (docs/DATA_FINDINGS.md).
     */
    pendingMaits: function (query) {
      return request({ path: '/admin/users/pending-maits/', query: query });
    },

    activateMait: function (body) {
      return request({ path: '/admin/users/activate-mait/', method: 'POST', body: body });
    },

    /** The whole Sahayak roster, activated or not — see the endpoint's own docstring. */
    maitRoster: function (query) {
      return request({ path: '/admin/users/maits/', query: query });
    },

    /**
     * Correct one Mait's number or coverage.
     *
     * `mpp_codes` is the complete set they cover, not an addition — MPPs left out of it are
     * unassigned, which is what moves their members to somebody else.
     */
    updateMait: function (vendorCode, body) {
      return request({
        path: '/admin/users/maits/' + encodeURIComponent(vendorCode) + '/',
        method: 'PATCH',
        body: body,
      });
    },

    /**
     * The Mait ↔ MPP assignment sheet, edited and sent back.
     *
     * Runs the same import pipeline as the SAP masters: accepted, queued, polled through
     * `uploadStatus`, with rejected rows available from `uploadErrors`.
     */
    uploadAssignments: function (file, onProgress) {
      const form = new FormData();
      form.append('file', file);
      return request({
        path: '/admin/uploads/assignments/',
        method: 'POST',
        body: form,
        ajax: sending(onProgress),
      });
    },

    /** Stock across every Mait. The mait/ endpoints only ever report the caller's own. */
    inventoryOversight: function () {
      return request({ path: '/admin/inventory/' });
    },

    /**
     * One Mait's stock, in the same breakdown they see in the app.
     *
     * The oversight list carries straw counts only, because that is what decides whether
     * someone can work. This is the rest of the answer.
     */
    maitInventory: function (maitId) {
      return request({ path: '/admin/inventory/' + maitId + '/' });
    },

    /**
     * Pregnancy diagnosis rolled up per Mait.
     *
     * `/admin/pregnancy/`, not the `/pregnancy-checks/` the app uses: that one scopes itself
     * to the caller's own `mait_profile`, and an admin has none — so it answers an empty list
     * rather than a 403, which is the worst of both. A screen that looks like it loaded and
     * says nobody owes a check.
     */
    pregnancyOversight: function () {
      return request({ path: '/admin/pregnancy/' });
    },

    /**
     * One Mait's checks, in the same shape the app shows them.
     *
     * `window` is `due` (open, oldest first), `done` or `all`. Oldest first rather than the
     * app's soonest-first: this screen is read to find what has been dropped, and soonest
     * puts exactly that at the bottom.
     */
    maitPregnancyChecks: function (maitId, query) {
      return request({ path: '/admin/pregnancy/' + maitId + '/', query: query });
    },

    indents: function (query) {
      return request({ path: '/indents/', query: query });
    },

    /**
     * A month's Mait payout, as the screen previews it.
     *
     * `month` is `YYYY-MM` and may be omitted, which answers for the month just gone — this
     * report is run to pay people for a month that has finished.
     *
     * Account numbers and PANs come back masked. The workbook behind `Download` carries them
     * whole, because it is a payment instruction and a masked account cannot be paid into.
     */
    maitPayment: function (query) {
      return request({ path: '/reports/mait-payment/', query: query });
    },

    /** The commission, retainer and straw rate the payout is computed from. */
    payoutScheme: function () {
      return request({ path: '/reports/mait-payment/scheme/' });
    },

    savePayoutScheme: function (body) {
      return request({ path: '/reports/mait-payment/scheme/', method: 'PATCH', body: body });
    },

    /**
     * The catalogue a Mait can ask for, straws aside.
     *
     * It is what names an indent: a request raised against a product that is not here reads
     * as "25 × Consumable" on every screen, which tells a depot nothing about what to pack.
     */
    products: function (query) {
      return request({ path: '/admin/products/', query: query });
    },

    createProduct: function (body) {
      return request({ path: '/admin/products/', method: 'POST', body: body });
    },

    updateProduct: function (id, body) {
      return request({ path: '/admin/products/' + id + '/', method: 'PATCH', body: body });
    },

    deleteProduct: function (id) {
      return request({ path: '/admin/products/' + id + '/', method: 'DELETE' });
    },

    /**
     * The semen list — the breeds a Mait can be issued and can ask for.
     *
     * Straws themselves are never typed in: they arrive by being issued against an indent,
     * by number or as a bundle of one of these breeds. This is the list behind that.
     */
    breeds: function (query) {
      return request({ path: '/admin/breeds/', query: query });
    },

    createBreed: function (body) {
      return request({ path: '/admin/breeds/', method: 'POST', body: body });
    },

    updateBreed: function (id, body) {
      return request({ path: '/admin/breeds/' + id + '/', method: 'PATCH', body: body });
    },

    deleteBreed: function (id) {
      return request({ path: '/admin/breeds/' + id + '/', method: 'DELETE' });
    },

    /**
     * Which masters have a landed upload behind them, and what it was.
     *
     * Asked rather than worked out from the upload history, because "landed" means a
     * particular set of statuses and a portal that guessed wrong would offer a download of a
     * file that never became the master.
     */
    uploadSnapshots: function () {
      return request({ path: '/admin/uploads/snapshots/' });
    },

    /**
     * How far a master download has got, by the token it was started with.
     *
     * Rows copied, out of rows to copy. It is the only honest measure of that wait: an xlsx
     * cannot be sent until it is finished, so until then the transfer has nothing to report
     * and the browser sees a flat zero.
     */
    uploadSnapshotProgress: function (token) {
      return request({
        path: '/admin/uploads/snapshots-progress/',
        query: { token: token },
      });
    },

    // One row, not a collection — a pregnancy diagnosis is the same work whatever the animal,
    // so it is priced once rather than eighteen times like the breeds above.
    pregnancyRate: function () {
      return request({ path: '/admin/pregnancy/rate/' });
    },

    updatePregnancyRate: function (body) {
      return request({ path: '/admin/pregnancy/rate/', method: 'PATCH', body: body });
    },

    approveIndent: function (id) {
      return request({ path: '/indents/' + id + '/approve/', method: 'POST', body: {} });
    },

    rejectIndent: function (id, reason) {
      return request({
        path: '/indents/' + id + '/reject/',
        method: 'POST',
        body: { reason: reason || '' },
      });
    },

    /**
     * Record a handover.
     *
     * Straw indents pass `straw_numbers` — the number printed on each straw — and never a
     * count: the app scans a number against the Mait's stock, so a quantity with nothing
     * behind it credits a balance that cannot be scanned. Consumables pass `qty`.
     */
    issueIndent: function (id, body) {
      return request({ path: '/indents/' + id + '/issue/', method: 'POST', body: body });
    },

    activationReadiness: function () {
      return request({ path: '/dashboard/activation-readiness/' });
    },

    createUser: function (body) {
      return request({ path: '/admin/users/', method: 'POST', body: body });
    },

    updateUser: function (id, body) {
      return request({ path: '/admin/users/' + id + '/', method: 'PATCH', body: body });
    },

    mpps: function (query) {
      return request({ path: '/mpp/', query: query });
    },

    /** Every plant with its name and MPP count — the directory's own filter list. */
    plants: function () {
      return request({ path: '/mpp/plants/' });
    },

    members: function (query) {
      return request({ path: '/members/', query: query });
    },

    /**
     * The farmers Maits registered in the field.
     *
     * `/admin/non-members/`, not the `/non-members/` the app uses: that one is scoped to the
     * Mait who created the row, so an admin calling it gets a 403 and an empty screen. Pass
     * `no_card: true` for the queue — the registrations with no Aadhaar image behind them.
     */
    nonMembers: function (query) {
      return request({ path: '/admin/non-members/', query: query });
    },

    /** One of them, with her animals and the card images. The read is audit-logged. */
    nonMember: function (id) {
      return request({ path: '/admin/non-members/' + id + '/' });
    },

    users: function (query) {
      return request({ path: '/admin/users/', query: query });
    },

    request: request,
  };
})(window.MaitAI, jQuery);
