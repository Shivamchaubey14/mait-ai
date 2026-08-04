/**
 * API client for the admin portal (SRS §9).
 *
 * Thin wrapper over jQuery AJAX. Every request goes through here so authentication, token
 * refresh and error shaping exist in exactly one place — a `$.ajax` call sprinkled into a
 * page would miss all three.
 */

/* global jQuery */
window.MaitAI = window.MaitAI || {};

(function (MaitAI, $) {
  'use strict';

  const BASE_URL = '/api/v1';
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
            window.location.href = '/login.html';
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

    aiEvents: function (query) {
      return request({ path: '/ai-events/', query: query });
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
