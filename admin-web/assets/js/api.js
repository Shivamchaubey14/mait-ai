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

  /* --- public surface ------------------------------------------------------------------
   * Mirrors docs/API_CONTRACT.md. Keep it in step — the contract is frozen, and a client
   * that drifts from it fails in production rather than in review.
   */
  MaitAI.api = {
    tokens: tokens,
    problemToLines: problemToLines,

    /** Exposed for the one caller that streams a file and cannot go through request(). */
    baseUrl: function () {
      return BASE_URL;
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

    me: function () {
      return request({ path: '/auth/me/' });
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
        ajax: {
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
        },
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
    uploadAssignments: function (file) {
      const form = new FormData();
      form.append('file', file);
      return request({ path: '/admin/uploads/assignments/', method: 'POST', body: form });
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

    indents: function (query) {
      return request({ path: '/indents/', query: query });
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

    members: function (query) {
      return request({ path: '/members/', query: query });
    },

    users: function (query) {
      return request({ path: '/admin/users/', query: query });
    },

    request: request,
  };
})(window.MaitAI, jQuery);
