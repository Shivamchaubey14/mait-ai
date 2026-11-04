/**
 * RTK Query endpoint definitions (docs/API_CONTRACT.md §9.1, §9.3).
 *
 * Injected into the base client rather than declared alongside it, so each feature owns its
 * own slice and `client.ts` never becomes a dumping ground.
 */

import { api, idempotencyHeaders } from './client';
import type {
  PdOutcome,
  PdRoute,
  PregnancyCheck,
  PregnancyCheckPage,
  AadhaarImages,
  AIEvent,
  AdminAiEventsPage,
  AdminMait,
  AdminMaitRoster,
  PendingMaitsPage,
  AdminNonMember,
  AdminBreed,
  StorePlantRow,
  StoreWrite,
  PregnancyRateConfig,
  CatalogueWrite,
  AdminNonMemberDetail,
  InventoryOversight,
  MaitStockAdjustment,
  MaitStockDetail,
  AdminStoreStock,
  StoreStockUpdate,
  ProductAdmin,
  StoreAdmin,
  MaitPaymentReport,
  Leaderboard,
  PregnancyOversight,
  ExceptionQueue,
  QueueName,
  MaitPregnancyChecks,
  PregnancyWindow,
  DashboardSummary,
  DashboardTrends,
  PayoutScheme,
  AuditQuery,
  AuditTrail,
  AdminUser,
  AdminUserCreate,
  AdminUserPatch,
  PortalSectionEntry,
  Zone,
  ZoneActivity,
  ZoneManager,
  ZoneManagers,
  ZonePlantRow,
  ZoneWrite,
  SuperOtpRow,
  OtpPipeline,
  OtpPipelineQuery,
  SuperOtpIssued,
  UploadJob,
  MasterSnapshot,
  MemberMobileChange,
  MemberMobileSaved,
  UploadErrorReport,
  MppCoverage,
  AIEventDraft,
  AIEventTimelineEntry,
  AdminAiEventDetail,
  AnimalTypeCode,
  BreedConfig,
  CurrentUser,
  FarmerKey,
  Payment,
  FarmerOtpSent,
  FarmerRosterRow,
  IdentityCheck,
  InventorySummary,
  Member,
  MemberDetail,
  MPP,
  NonMember,
  NonMemberDetail,
  NonMemberSummary,
  NonMemberDraft,
  Product,
  Indent,
  IndentDraft,
  StoreCatalogue,
  StoreHandover,
  StoreHome,
  StoreIndent,
  StoreReceipt,
  StoreStockLine,
  ZonalApproval,
  ZonalDashboard,
  ZonalHistory,
  ZonalEvent,
  ZonalEventPage,
  ZonalHome,
  ZonalMait,
  ZonalLookup,
  AssignResult,
  ZoneStock,
  ZonePerformance,
  Paginated,
  StrawValidation,
  TokenPair,
} from './types';

/** A plain array or a page, as a page: some admin lists are served with pagination off. */
function asPage<T>(body: T[] | Paginated<T> | null | undefined): Paginated<T> {
  if (Array.isArray(body)) {
    return { count: body.length, next: null, previous: null, results: body };
  }
  return body ?? { count: 0, next: null, previous: null, results: [] };
}

/**
 * How long a request that sends or checks a farmer's code may take before it gives up.
 *
 * React Native's fetch has no timeout of its own. A tap on "Send the code" in a dead patch
 * opened a connection that never answered and never failed, so the button span for as long as
 * the Mait would watch it — and when signal came back, the stuck request did not recover with
 * it. Capped, it fails in a bounded time with a network error the screen can name, and the
 * screen sends again by itself once the connection returns.
 */
export const CODE_REQUEST_CAP_MS = 12_000;

export const maitaiApi = api.injectEndpoints({
  // Fast Refresh re-evaluates this module on every save, which re-injects endpoints that are
  // already registered and fills the log with "called injectEndpoints to override
  // already-existing endpointName". Harmless, and noisy enough to bury a real error next to
  // it. Never on in a release build, where the module is evaluated once.
  overrideExisting: __DEV__,
  endpoints: builder => ({
    // ---- auth ----------------------------------------------------------------------
    sendLoginOtp: builder.mutation<{ detail: string; expires_in_seconds: number }, string>({
      query: mobileNo => ({
        url: '/auth/otp/send/',
        method: 'POST',
        body: { mobile_no: mobileNo },
      }),
    }),

    verifyLoginOtp: builder.mutation<TokenPair, { mobileNo: string; otp: string }>({
      query: ({ mobileNo, otp }) => ({
        url: '/auth/otp/verify/',
        method: 'POST',
        body: { mobile_no: mobileNo, otp },
      }),
    }),

    /**
     * Ask the office for a sign-in code, because the SMS is not arriving.
     *
     * The answer is the same whether or not the number is registered. The office generates a
     * code on the portal and calls the number on file with it; it goes into the same boxes.
     */
    requestSuperOtp: builder.mutation<
      { detail: string; expires_in_seconds: number },
      { mobileNo: string; reason?: string }
    >({
      query: ({ mobileNo, reason }) => ({
        url: '/auth/otp/super/request/',
        method: 'POST',
        body: { mobile_no: mobileNo, reason: reason ?? '' },
      }),
    }),

    /**
     * The farmer's SMS code did not reach her: ask the office to phone it to her.
     *
     * Her number comes off her record on the server, never from here. Refused until the SMS has
     * actually been tried for her.
     */
    askFarmerOfficeCode: builder.mutation<
      { detail: string; mobile_no: string; expires_in_seconds: number },
      FarmerKey
    >({
      query: key => ({
        url: '/farmers/otp/office/',
        method: 'POST',
        body: key,
        timeout: CODE_REQUEST_CAP_MS,
      }),
    }),

    /** The same for her payment authorisation code, for one of the Mait's own events. */
    askPaymentOfficeCode: builder.mutation<
      { detail: string; mobile_no: string; expires_in_seconds: number },
      { eventId: number }
    >({
      query: ({ eventId }) => ({
        url: `/payments/${eventId}/otp/office/`,
        method: 'POST',
        body: {},
        timeout: CODE_REQUEST_CAP_MS,
      }),
    }),

    logout: builder.mutation<void, string>({
      query: refresh => ({ url: '/auth/logout/', method: 'POST', body: { refresh } }),
    }),

    /**
     * The signed-in user's profile and MPP scope.
     *
     * Takes the access token as an argument because of *when* login calls it: the profile is
     * fetched before the session is marked live, so at that moment there is no token in the
     * store for `prepareHeaders` to attach. Without this the request goes out unauthenticated,
     * comes back 401, and the sign-in fails at the last step with the tokens already issued.
     * Called anywhere else, the argument is unnecessary and the store's token is used.
     */
    getCurrentUser: builder.query<CurrentUser, string | void>({
      query: accessToken => ({
        url: '/auth/me/',
        ...(accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}),
      }),
    }),

    // ---- master data ---------------------------------------------------------------
    // The server already scopes these to the signed-in Mait, so the app never sends a
    // "which Mait am I" filter — one that could be omitted or altered.
    listMpps: builder.query<Paginated<MPP>, { search?: string } | void>({
      query: args => ({
        url: '/mpp/',
        params: { limit: 100, ...(args?.search ? { search: args.search } : {}) },
      }),
      providesTags: ['MPP'],
    }),

    listMembers: builder.query<Paginated<Member>, { mppCode: string; search?: string }>({
      query: ({ mppCode, search }) => ({
        url: '/members/',
        params: {
          mpp__mpp_code: mppCode,
          limit: 50,
          ...(search ? { search } : {}),
        },
      }),
      providesTags: ['Member'],
    }),

    getMember: builder.query<MemberDetail, string>({
      query: memberCode => `/members/${memberCode}/`,
      providesTags: ['Member'],
    }),

    /**
     * Is she already on file? — asked while the number is still going in.
     *
     * A mutation rather than a query because it must never be served from a cache: the answer
     * is about a number the Mait is typing *now*, and a stale "she is free" on the one screen
     * that ends with a farmer being asked for cash is the worst possible thing to cache.
     *
     * It answers with the same rule the create enforces, from one implementation server-side,
     * so the form cannot promise something the create then refuses.
     */
    checkFarmerIdentity: builder.mutation<IdentityCheck, { aadharNo?: string; mobileNo?: string }>({
      query: ({ aadharNo, mobileNo }) => ({
        url: '/non-members/check/',
        method: 'POST',
        body: {
          ...(aadharNo ? { aadhar_no: aadharNo } : {}),
          ...(mobileNo ? { mobile_no: mobileNo } : {}),
        },
      }),
    }),

    createNonMember: builder.mutation<NonMember, NonMemberDraft>({
      query: body => ({ url: '/non-members/', method: 'POST', body }),
      invalidatesTags: ['Member'],
    }),

    /**
     * The non-members already registered at an MPP.
     *
     * What step 3 offers before it offers a form. Without it the only path a Mait had was
     * registering somebody, so the second visit to the same farmer registered her a second
     * time — and now that one Aadhaar is one farmer, that path refuses outright.
     *
     * Scoped server-side to the MPPs this Mait covers, so the app never sends a "which Mait
     * am I" filter that could be omitted or altered.
     */
    listNonMembers: builder.query<
      Paginated<NonMemberSummary>,
      { mppCode: string; search?: string }
    >({
      query: ({ mppCode, search }) => ({
        url: '/non-members/',
        params: {
          mpp__mpp_code: mppCode,
          limit: 50,
          ...(search ? { search } : {}),
        },
      }),
      providesTags: ['Member'],
    }),

    /**
     * The collection point's books, thin enough to keep on the handset.
     *
     * Fetched when the registration form opens and answered from the offline cache thereafter,
     * so a Mait registering a farmer in a village with no signal is still warned when her
     * number is already on file. The Aadhaar check cannot work this way and never will; this
     * is the half that can travel.
     */
    getFarmerRoster: builder.query<FarmerRosterRow[], string>({
      query: mppCode => ({ url: '/non-members/roster/', params: { mpp__mpp_code: mppCode } }),
      providesTags: ['Member'],
    }),

    getNonMember: builder.query<NonMemberDetail, number>({
      query: id => `/non-members/${id}/`,
      providesTags: ['Member', 'Animal'],
    }),

    /**
     * Both faces of her Aadhaar card, sent once the record exists.
     *
     * A second call rather than part of the registration, for the same reason the animal's
     * portrait is: the farmer must be on file even if the upload dies on a village
     * connection. Losing the images costs a retry; losing the registration costs the whole
     * form again with her standing there.
     *
     * Either face may be sent alone, so a retry re-sends only what failed.
     */
    uploadNonMemberAadhaar: builder.mutation<NonMember, { id: number } & AadhaarImages>({
      query: ({ id, front, back }) => {
        const form = new FormData();
        if (front) {
          form.append('front', {
            uri: front,
            name: 'aadhaar-front.jpg',
            type: 'image/jpeg',
          } as unknown as Blob);
        }
        if (back) {
          form.append('back', {
            uri: back,
            name: 'aadhaar-back.jpg',
            type: 'image/jpeg',
          } as unknown as Blob);
        }
        return { url: `/non-members/${id}/aadhaar/`, method: 'PATCH', body: form };
      },
      invalidatesTags: ['Member'],
    }),

    // ---- animals -------------------------------------------------------------------
    // Fetched whole and cached: a couple of dozen rows, and the picker has to keep working
    // in a yard with no signal (SRS §6.3.2).
    listBreeds: builder.query<BreedConfig[], AnimalTypeCode | void>({
      query: animalType => ({
        url: '/config/breeds/',
        params: animalType ? { animal_type: animalType } : undefined,
      }),
      providesTags: ['Animal'],
    }),

    /**
     * Send the farmer a code, to her own number.
     *
     * The app never says where it should go: the server reads that off her record. A Mait who
     * could nominate the destination could nominate their own phone, and a verification a
     * Mait can satisfy alone verifies nothing.
     */
    sendFarmerOtp: builder.mutation<FarmerOtpSent, FarmerKey>({
      query: body => ({
        url: '/farmers/otp/send/',
        method: 'POST',
        body,
        timeout: CODE_REQUEST_CAP_MS,
      }),
    }),

    verifyFarmerOtp: builder.mutation<{ verified: boolean }, FarmerKey & { otp: string }>({
      query: body => ({
        url: '/farmers/otp/verify/',
        method: 'POST',
        body,
        timeout: CODE_REQUEST_CAP_MS,
      }),
    }),

    /**
     * Record how this insemination is paid for.
     *
     * A member's mode is not the app's to choose — the server records a deduction against her
     * milk payment whatever is sent. A non-member's is COD or ONLINE, and the authorisation
     * code goes to her own number.
     */
    initiatePayment: builder.mutation<Payment, { eventId: number; mode?: 'COD' | 'ONLINE' }>({
      query: ({ eventId, mode }) => ({
        url: `/payments/${eventId}/initiate/`,
        method: 'POST',
        body: mode ? { mode } : {},
        // Initiating sends her the payment code.
        timeout: CODE_REQUEST_CAP_MS,
      }),
      invalidatesTags: ['Payment', 'AIEvent'],
    }),

    verifyPaymentOtp: builder.mutation<Payment, { eventId: number; otp: string }>({
      query: ({ eventId, otp }) => ({
        url: `/payments/${eventId}/otp/verify/`,
        method: 'POST',
        body: { otp },
        timeout: CODE_REQUEST_CAP_MS,
      }),
      invalidatesTags: ['Payment', 'AIEvent'],
    }),

    /**
     * The UTR and the screenshot behind an online payment (SRS §6.5.4).
     *
     * **Not optional, and not a nicety.** An online payment is only verified once all three
     * of the farmer's code, the UTR and the screenshot are on file — so without this call the
     * payment stays pending, the completion is refused `payment-not-verified`, and the straw
     * is never deducted. The capture then reappears in Unfinished with no clue why.
     *
     * Both together, never either: a UTR alone is a number a Mait could invent, and a
     * screenshot alone is an image nobody can reconcile against a bank statement.
     */
    attachPaymentProof: builder.mutation<
      Payment,
      { eventId: number; utrNumber: string; screenshot: string }
    >({
      query: ({ eventId, utrNumber, screenshot }) => {
        const form = new FormData();
        form.append('utr_number', utrNumber);
        form.append('screenshot', {
          uri: screenshot,
          name: 'payment-proof.jpg',
          type: 'image/jpeg',
        } as unknown as Blob);
        return { url: `/payments/${eventId}/proof/`, method: 'POST', body: form };
      },
      invalidatesTags: ['Payment', 'AIEvent'],
    }),

    /*
     * Registering an animal and sending her portrait used to live here, as two mutations.
     * They moved to `api/capture` alongside the writes of the capture flow, because a cow is
     * registered in a yard with no signal as often as with one and an RTK Query mutation has
     * nowhere to put a request the network cannot carry. The endpoints they called are
     * unchanged; what changed is that a failure now queues instead of stopping the step.
     */

    // ---- inventory -----------------------------------------------------------------
    /** The catalogue behind the stock request form. Cached — it changes rarely. */
    listProducts: builder.query<Product[], void>({
      query: () => '/config/products/',
      providesTags: ['Inventory'],
    }),

    getInventorySummary: builder.query<InventorySummary, void>({
      query: () => '/mait/inventory/',
      providesTags: ['Inventory'],
    }),

    /**
     * Check a straw before committing to it.
     *
     * Answers 200 either way — a rejected scan is a normal outcome of the flow, not a failed
     * request. The app reads `reason` to decide what to tell the Mait to do about it.
     */
    validateStraw: builder.query<StrawValidation, { uniqueNo: string; breed?: string }>({
      query: ({ uniqueNo, breed }) => ({
        url: `/semen-batches/${encodeURIComponent(uniqueNo)}/validate/`,
        params: breed ? { breed } : undefined,
      }),
      providesTags: ['Inventory'],
    }),

    // ---- AI event ------------------------------------------------------------------
    createAiEvent: builder.mutation<AIEvent, AIEventDraft>({
      query: body => ({
        url: '/ai-events/',
        method: 'POST',
        // Keyed on the device-generated uuid, so a retry after a dropped response returns
        // the event that already exists instead of recording a second insemination.
        headers: idempotencyHeaders(body.client_uuid),
        body,
      }),
      // The straws and the supplies both come off stock at completion, so what the app is
      // holding as "in my flask" is out of date the moment a capture opens.
      invalidatesTags: ['AIEvent', 'Inventory'],
    }),

    // ---- indents -------------------------------------------------------------------
    /**
     * Raise a stock request (SRS §6.6.1).
     *
     * Straws are asked for by breed, not by straw number — which physical straws get issued
     * is decided at the depot, not by the Mait asking.
     */
    createIndent: builder.mutation<Indent, IndentDraft>({
      query: body => ({
        url: '/indents/',
        method: 'POST',
        headers: idempotencyHeaders(body.client_uuid),
        body: {
          product_type: body.product_type,
          breed: body.breed,
          product_ref_id: body.product_ref_id,
          qty_requested: body.qty_requested,
          note: body.note,
        },
      }),
      invalidatesTags: ['Indent'],
    }),

    listIndents: builder.query<Paginated<Indent>, void>({
      query: () => '/indents/',
      providesTags: ['Indent'],
    }),

    getIndent: builder.query<Indent, number>({
      query: id => `/indents/${id}/`,
      providesTags: ['Indent'],
    }),

    /**
     * The Mait acknowledges that issued stock reached them.
     *
     * This is where the stock becomes theirs — until they collect, it is at the depot — so
     * `Inventory` goes stale the moment it lands. Stock handed over at a store needs `code`,
     * the four digits the keeper read out at the counter.
     */
    confirmIndentCollection: builder.mutation<Indent, { id: number; code?: string }>({
      query: ({ id, code }) => ({
        url: `/indents/${id}/confirm-collection/`,
        method: 'POST',
        body: code ? { code } : {},
      }),
      invalidatesTags: ['Indent', 'Inventory'],
    }),

    // ---- store keeper ----------------------------------------------------------------
    /**
     * A store keeper's side of an indent: the queue at their counter, and the shelf behind it.
     *
     * All under `/store/`, which answers a keeper and nobody else. Everything is tagged
     * `Store` and a handover invalidates the lot: issuing changes the queue, the shelf and the
     * figures on the first screen at once, and three screens disagreeing about the same 18
     * straws is worse than one refetch.
     */
    getStoreHome: builder.query<StoreHome, void>({
      query: () => '/store/',
      providesTags: ['Store'],
    }),

    listStoreIndents: builder.query<StoreIndent[], void>({
      query: () => '/store/indents/',
      providesTags: ['Store'],
    }),

    getStoreIndent: builder.query<StoreIndent, number>({
      query: id => `/store/indents/${id}/`,
      providesTags: ['Store'],
    }),

    /**
     * Hand some or all of an indent over.
     *
     * The key rides along so a tap repeated over a bad connection hands over once — the second
     * request is answered with the first handover, code and all.
     */
    issueFromStore: builder.mutation<
      StoreHandover,
      { id: number; qty: number; flaskChecked: boolean; clientUuid: string }
    >({
      query: ({ id, qty, flaskChecked, clientUuid }) => ({
        url: `/store/indents/${id}/issue/`,
        method: 'POST',
        headers: idempotencyHeaders(clientUuid),
        body: { qty, flask_checked: flaskChecked },
      }),
      invalidatesTags: ['Store'],
    }),

    listStoreHandovers: builder.query<StoreHandover[], 'waiting' | 'today'>({
      query: state => ({ url: '/store/handovers/', params: { state } }),
      providesTags: ['Store'],
    }),

    /**
     * Everything this store handed over between two local days, newest first — the keeper's
     * History tab. The days are the handset's own, sent as `YYYY-MM-DD`.
     */
    listStoreHistory: builder.query<StoreHandover[], { from: string; to: string }>({
      query: ({ from, to }) => ({ url: '/store/handovers/', params: { from, to } }),
      providesTags: ['Store'],
    }),

    getStoreHandover: builder.query<StoreHandover, number>({
      query: id => `/store/handovers/${id}/`,
      providesTags: ['Store'],
    }),

    cancelStoreHandover: builder.mutation<StoreHandover, number>({
      query: id => ({ url: `/store/handovers/${id}/cancel/`, method: 'POST' }),
      invalidatesTags: ['Store'],
    }),

    newHandoverCode: builder.mutation<StoreHandover, number>({
      query: id => ({ url: `/store/handovers/${id}/new-code/`, method: 'POST' }),
      invalidatesTags: ['Store'],
    }),

    getStoreStock: builder.query<StoreStockLine[], void>({
      query: () => '/store/stock/',
      providesTags: ['Store'],
    }),

    getStoreCatalogue: builder.query<StoreCatalogue, void>({
      query: () => '/store/catalogue/',
    }),

    receiveStoreStock: builder.mutation<StoreStockLine[], StoreReceipt>({
      query: body => ({
        url: '/store/stock/receive/',
        method: 'POST',
        headers: idempotencyHeaders(body.client_uuid),
        body: {
          product_type: body.product_type,
          breed: body.breed,
          product_ref_id: body.product_ref_id,
          qty: body.qty,
          note: body.note,
        },
      }),
      invalidatesTags: ['Store'],
    }),

    /**
     * The Mait's own events.
     *
     * `unfinished: true` asks for the captures that still need something from them. Which
     * statuses those are is decided server-side — the app asks the question and knows where
     * each answer resumes, but it does not keep its own list of what "unfinished" means.
     */
    listAiEvents: builder.query<
      Paginated<AIEvent>,
      {
        status?: string;
        unfinished?: boolean;
        dateFrom?: string;
        dateTo?: string;
        /** `office_call_unmatched` for the Needs attention list. */
        farmerCheck?: string;
      } | void
    >({
      query: args => ({
        url: '/ai-events/',
        params: {
          ...(args?.status ? { status: args.status } : {}),
          ...(args?.unfinished ? { unfinished: true, limit: 50 } : {}),
          // `YYYY-MM-DD`, both inclusive. A month's total is read off `count` rather than by
          // pulling the rows: Profile wants the number, and a Mait who has done two hundred
          // inseminations should not be made to download two hundred records to see it.
          ...(args?.dateFrom ? { date_from: args.dateFrom } : {}),
          ...(args?.dateTo ? { date_to: args.dateTo } : {}),
          ...(args?.farmerCheck ? { farmer_check: args.farmerCheck } : {}),
        },
      }),
      providesTags: ['AIEvent'],
    }),

    /**
     * One event, read fresh rather than picked out of the list.
     *
     * The list is capped at a page and is filtered; an event opened from a notification, or
     * from a row cached before a payment landed, has to be able to ask for itself. Tagged
     * `AIEvent` like the list, so completing a capture invalidates both together.
     */
    /**
     * The checks this Mait owes a visit.
     *
     * `due` is the default and what the list opens on: open checks that are overdue or fall
     * inside the seven-day window. Overdue never drops off — an animal quietly removed from
     * the round is a conception rate computed over the convenient visits.
     */
    listPregnancyChecks: builder.query<
      PregnancyCheckPage,
      { window?: 'due' | 'done' | 'all' } | void
    >({
      query: args => ({
        url: '/pregnancy-checks/',
        params: { window: args?.window ?? 'due', limit: 100 },
      }),
      providesTags: ['Pregnancy'],
    }),

    /**
     * Today's round, ordered two ways.
     *
     * Both orderings come back together so the reorder screen needs no second request and the
     * figures cannot move between the two screens — which is what that screen promises.
     * Skipped without a fix rather than sending nulls: the server orders from the first stop
     * when it has no start, and asking with a half-answer would hide that.
     */
    getPdRoute: builder.query<PdRoute, { lat?: number; lng?: number } | void>({
      query: args => ({
        url: '/pregnancy-checks/route/',
        params: args?.lat && args?.lng ? { lat: args.lat, lng: args.lng } : undefined,
      }),
      providesTags: ['Pregnancy'],
    }),

    /**
     * What the Mait found.
     *
     * `clientUuid` is minted when the outcome is tapped, not when the request leaves — a
     * check is done in a yard with no signal as often as not, and a key generated at send
     * time is new on every retry and deduplicates nothing (ADR 0003).
     *
     * Invalidates `AIEvent` as well as `Pregnancy`: a "not pregnant" is usually followed by a
     * fresh insemination on the spot, and the history behind it is out of date the moment
     * this lands.
     */
    recordPregnancyCheck: builder.mutation<
      PregnancyCheck,
      { id: number; outcome: PdOutcome; photoUrl?: string; note?: string; clientUuid: string }
    >({
      query: ({ id, outcome, photoUrl, note, clientUuid }) => ({
        url: `/pregnancy-checks/${id}/record/`,
        method: 'POST',
        body: {
          outcome,
          ...(photoUrl ? { photo_url: photoUrl } : {}),
          ...(note ? { note } : {}),
          client_uuid: clientUuid,
        },
      }),
      invalidatesTags: ['Pregnancy', 'AIEvent'],
    }),

    // ---- zonal manager -----------------------------------------------------------------
    /**
     * The zonal manager's side of the same product: the zone's work, what is waiting on their
     * decision, the stock behind it, and every decision they have already taken.
     *
     * Five reads under `/zonal/`, which answers a manager and nobody else, plus two writes
     * that are deliberately *not* theirs. The decision posts to
     * `/indents/{id}/approve|reject/` — where the state machine, the store routing and the
     * audit entry already live. A second copy would be a second answer for the portal to
     * disagree with.
     *
     * Everything is tagged `Zonal` and a decision invalidates the lot: approving an indent
     * changes the queue, the badge on the tab bar and the history at once, and three screens
     * disagreeing about the same request is worse than one refetch. `Indent` goes with it,
     * because that is what actually changed.
     */
    getZonalHome: builder.query<ZonalHome, void>({
      query: () => '/zonal/',
      providesTags: ['Zonal'],
    }),

    /** The zone's work, live. `days` is the trend window the chart draws. */
    getZonalDashboard: builder.query<ZonalDashboard, { days?: number } | void>({
      query: args => ({ url: '/zonal/dashboard/', params: { days: args?.days ?? 7 } }),
      providesTags: ['Zonal'],
    }),

    listZonalApprovals: builder.query<{ count: number; results: ZonalApproval[] }, void>({
      query: () => '/zonal/approvals/',
      providesTags: ['Zonal'],
    }),

    /** The zone's stock, grouped by chilling centre — and flat, by Mait and by depot. */
    getZoneStock: builder.query<ZoneStock, void>({
      query: () => '/zonal/stock/',
      providesTags: ['Zonal', 'Inventory'],
    }),

    /** Every approval and rejection they have made, with where each one got to since. */
    getZonalHistory: builder.query<
      ZonalHistory,
      { days?: number; outcome?: 'all' | 'approved' | 'rejected' } | void
    >({
      query: args => ({
        url: '/zonal/history/',
        params: { days: args?.days ?? 30, outcome: args?.outcome ?? 'all' },
      }),
      providesTags: ['Zonal'],
    }),

    /**
     * One insemination, whole — the record behind a row in the zone's feed.
     *
     * Its own tag rather than `Zonal`, so approving an indent does not throw away a record
     * somebody is reading: nothing a manager can do from this app changes an AI event, and a
     * refetch mid-dispute is a screen that blanks while somebody is being argued with.
     */
    /**
     * The zone's inseminations, a page at a time, narrowed by dates.
     *
     * Each page is its own cache entry, keyed on its offset; the screen holds the pages it has
     * asked for and joins them, so "Load more" never refetches what is already on screen.
     */
    listZonalEvents: builder.query<
      ZonalEventPage,
      { dateFrom?: string; dateTo?: string; offset?: number; limit?: number }
    >({
      query: ({ dateFrom, dateTo, offset = 0, limit = 30 }) => ({
        url: '/zonal/events/',
        params: {
          ...(dateFrom ? { date_from: dateFrom } : {}),
          ...(dateTo ? { date_to: dateTo } : {}),
          offset,
          limit,
        },
      }),
      providesTags: ['Zonal'],
    }),

    getZonalEvent: builder.query<ZonalEvent, number>({
      query: id => `/zonal/events/${id}/`,
      providesTags: (result, error, id) => [{ type: 'AIEvent', id }],
    }),

    /**
     * Agree to a request. Moves no stock — the depot hands it over and the Mait's code
     * credits it, which is the same chain whoever pressed this.
     */
    approveIndent: builder.mutation<unknown, number>({
      query: id => ({ url: `/indents/${id}/approve/`, method: 'POST' }),
      invalidatesTags: ['Zonal', 'Indent'],
    }),

    /**
     * Decline it, with the reason.
     *
     * The reason is not optional in the app even though the API allows a blank one: the Mait
     * reads the indent, not the audit log, and "rejected" with nothing under it is a phone
     * call to the office that somebody has to take.
     */
    rejectIndent: builder.mutation<unknown, { id: number; reason: string }>({
      query: ({ id, reason }) => ({
        url: `/indents/${id}/reject/`,
        method: 'POST',
        body: { reason },
      }),
      invalidatesTags: ['Zonal', 'Indent'],
    }),

    /**
     * The Maits a manager can hand a collection point to.
     *
     * No search is the zone's own roster — who a reassignment moves a point between. A search
     * widens to every active Mait by name or vendor code, for the other half of the job:
     * giving a point to a Mait who covers nothing here yet, and so is not on the zone list.
     */
    listZonalMaits: builder.query<{ results: ZonalMait[] }, { search?: string } | void>({
      query: args => ({
        url: '/zonal/maits/',
        params: args?.search ? { q: args.search } : {},
      }),
      providesTags: ['Zonal', 'MPP'],
    }),

    /**
     * A read-only lookup, both ways off one query: a Mait to the points they hold, a point to
     * the Mait that holds it (W19's sibling). Empty `q` returns two empty lists, so a blank box
     * never fetches the network.
     */
    zonalLookup: builder.query<ZonalLookup, { q: string }>({
      query: ({ q }) => ({ url: '/zonal/lookup/', params: { q } }),
      providesTags: ['Zonal', 'MPP'],
    }),

    /**
     * Hand one MPP, by its code, to one Mait, by their vendor code (W19, one point at a time).
     *
     * Invalidates `Zonal` so every figure that counts Maits and points redraws, and `MPP` so
     * the Mait's own app picks up its new coverage the next time it asks.
     */
    assignZonalMpp: builder.mutation<AssignResult, { sahayakVendorCode: string; mppCode: string }>({
      query: ({ sahayakVendorCode, mppCode }) => ({
        url: '/zonal/assignments/',
        method: 'POST',
        body: { sahayak_vendor_code: sahayakVendorCode, mpp_code: mppCode },
      }),
      invalidatesTags: ['Zonal', 'MPP'],
    }),

    getAiEvent: builder.query<AdminAiEventDetail, number>({
      query: id => `/ai-events/${id}/`,
      providesTags: ['AIEvent'],
    }),

    /**
     * The step-by-step trail behind one event.
     *
     * Its own request because it is its own thing: the record renders without it, and on a
     * village connection a trail that failed to load must not take the event down with it.
     */
    getAiEventTimeline: builder.query<AIEventTimelineEntry[], number>({
      query: id => `/ai-events/${id}/timeline/`,
      providesTags: ['AIEvent'],
    }),

    // ---- admin (office account on a handset) --------------------------------------------
    /**
     * Username + password, the Admin door — the one role that does not take an OTP (a desk
     * account, not a field phone). Maits, keepers and managers use `/auth/otp/*`.
     */
    passwordLogin: builder.mutation<TokenPair, { username: string; password: string }>({
      query: body => ({ url: '/auth/login/', method: 'POST', body }),
    }),

    /**
     * Ask for a password-reset code (POST /auth/password/reset/request/). The code goes to the
     * number already on the account, never to one typed here, and the answer is the same
     * whether or not the username is real — so office accounts cannot be probed.
     */
    passwordResetRequest: builder.mutation<
      { detail: string; expires_in_seconds: number },
      { username: string }
    >({
      query: body => ({ url: '/auth/password/reset/request/', method: 'POST', body }),
    }),

    /**
     * Verify the code and set the new password (POST /auth/password/reset/verify/). A wrong
     * username, a wrong code and an expired one answer alike, by design.
     */
    passwordResetVerify: builder.mutation<
      { detail: string },
      { username: string; otp: string; new_password: string }
    >({
      query: body => ({ url: '/auth/password/reset/verify/', method: 'POST', body }),
    }),

    /**
     * Every AI event in the network, for the admin roster — the portal's AI events screen on a
     * handset. Scoped by the server to the account's zones (all of it for a head-office admin),
     * filterable by one search box, a status and a date range, and carrying the set-wide status
     * `summary` beside the page.
     */
    adminListAiEvents: builder.query<
      AdminAiEventsPage,
      {
        search?: string;
        status?: string;
        mpp?: string;
        unfinished?: boolean;
        dateFrom?: string;
        dateTo?: string;
        offset?: number;
        /** Rows per page; the Reports preview asks for ten. */
        limit?: number;
      } | void
    >({
      query: args => ({
        url: '/ai-events/',
        params: {
          limit: args?.limit ?? 25,
          ...(args?.search ? { search: args.search } : {}),
          ...(args?.status ? { status: args.status } : {}),
          ...(args?.mpp ? { mpp: args.mpp } : {}),
          ...(args?.unfinished ? { unfinished: true } : {}),
          ...(args?.dateFrom ? { date_from: args.dateFrom } : {}),
          ...(args?.dateTo ? { date_to: args.dateTo } : {}),
          ...(args?.offset ? { offset: args.offset } : {}),
        },
      }),
      providesTags: ['AIEvent'],
    }),

    /** Delete one AI event (admin/super_admin only — a Normal User is refused by the server). */
    deleteAiEvent: builder.mutation<void, number>({
      query: id => ({ url: `/ai-events/${id}/`, method: 'DELETE' }),
      invalidatesTags: ['AIEvent'],
    }),

    /**
     * Delete several AI events in one transaction (admin only) — all or nothing, so there is
     * never a half-finished delete to puzzle over.
     */
    bulkDeleteAiEvents: builder.mutation<
      { deleted: number[]; deleted_count: number; missing: number[] },
      number[]
    >({
      query: ids => ({ url: '/ai-events/bulk-delete/', method: 'POST', body: { ids } }),
      invalidatesTags: ['AIEvent'],
    }),

    /**
     * Close a member's capture the Mait left stuck with its deduction already verified (admin
     * only). The same thing the handset would do: the straw comes off the Mait's stock and the
     * pregnancy check is booked. The server refuses anything else.
     */
    officeCompleteAiEvent: builder.mutation<AIEvent, number>({
      query: id => ({ url: `/ai-events/${id}/office-complete/`, method: 'POST', body: {} }),
      invalidatesTags: ['AIEvent', 'Inventory'],
    }),

    /**
     * Search members across the network, for the admin roster. One box over name, member code
     * and mobile; scoped to the account's zones by the server.
     */
    adminSearchMembers: builder.query<Paginated<Member>, { search?: string } | void>({
      query: args => ({
        url: '/members/',
        params: { limit: 25, ...(args?.search ? { search: args.search } : {}) },
      }),
      providesTags: ['Member'],
    }),

    /**
     * The member master for the admin's Members screen: one search box, an MPP, members with
     * no number, and numbers the office set. Paged 25 at a time over 105k rows.
     */
    adminListMembers: builder.query<
      Paginated<Member>,
      { search?: string; mpp?: string; noMobile?: boolean; office?: boolean; offset?: number }
    >({
      query: args => ({
        url: '/members/',
        params: {
          limit: 25,
          ...(args.search ? { search: args.search } : {}),
          ...(args.mpp ? { mpp__mpp_code: args.mpp } : {}),
          ...(args.noMobile ? { no_mobile: 'true' } : {}),
          ...(args.office ? { mobile_source: 'office' } : {}),
          ...(args.offset ? { offset: args.offset } : {}),
        },
      }),
      providesTags: ['Member'],
    }),

    /**
     * One member's full Aadhaar (GET /members/{code}/aadhaar/) — logged against the account,
     * rate-limited, and never cached: a mutation, so RTK Query keeps no copy of it.
     */
    revealMemberAadhaar: builder.mutation<
      { member_code: string; aadhar_no: string; on_file: boolean },
      string
    >({
      query: code => ({ url: `/members/${encodeURIComponent(code)}/aadhaar/`, method: 'GET' }),
    }),

    /** Every change the office made to a member's number. */
    memberMobileHistory: builder.query<{ results: MemberMobileChange[] }, string>({
      query: code => `/members/${encodeURIComponent(code)}/mobile-history/`,
      providesTags: ['Member'],
    }),

    /**
     * Set a member's number (Admin only). `expected_mobile` is the number the change was opened
     * on: if a colleague changed it since, the server answers 409 rather than letting this
     * save quietly undo their correction.
     */
    changeMemberMobile: builder.mutation<
      MemberMobileSaved,
      { code: string; mobile_no: string; reason: string; expected_mobile: string }
    >({
      query: ({ code, ...body }) => ({
        url: `/members/${encodeURIComponent(code)}/mobile/`,
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Member'],
    }),

    /** The Mait roster (GET /admin/users/maits/), searchable by name, vendor code or mobile. */
    adminListMaits: builder.query<
      AdminMaitRoster,
      {
        search?: string;
        needsMobile?: boolean;
        notActivated?: boolean;
        deactivated?: boolean;
        offset?: number;
      } | void
    >({
      query: args => ({
        url: '/admin/users/maits/',
        params: {
          limit: 25,
          ...(args?.search ? { search: args.search } : {}),
          ...(args?.needsMobile ? { needs_mobile: 'true' } : {}),
          ...(args?.notActivated ? { activated: 'false' } : {}),
          ...(args?.deactivated ? { account_active: 'false' } : {}),
          ...(args?.offset ? { offset: args.offset } : {}),
        },
      }),
      providesTags: ['MPP', 'Mait'],
    }),

    /**
     * The activation queue (GET /admin/users/pending-maits/): Maits with no login yet, in name
     * order. `summary` counts the whole backlog, not the search.
     */
    adminPendingMaits: builder.query<PendingMaitsPage, { search?: string } | void>({
      query: args => ({
        url: '/admin/users/pending-maits/',
        params: { limit: 500, ...(args?.search ? { search: args.search } : {}) },
      }),
      providesTags: ['Mait'],
    }),

    /**
     * Give a pending Mait a login and the number their OTP goes to (POST
     * /admin/users/activate-mait/). The server checks the number against every other Mait.
     */
    adminActivateMait: builder.mutation<
      AdminUser,
      { sahayak_vendor_code: string; mobile_no: string }
    >({
      query: body => ({ url: '/admin/users/activate-mait/', method: 'POST', body }),
      invalidatesTags: ['Mait'],
    }),

    /**
     * Correct one Mait's name, number and coverage (PATCH /admin/users/maits/{code}/).
     * `mpp_codes` is the complete set — an MPP missing from it is unassigned.
     */
    adminUpdateMait: builder.mutation<
      AdminMait,
      { code: string; name: string; mobile_no: string; mpp_codes: string[] }
    >({
      query: ({ code, ...body }) => ({
        url: `/admin/users/maits/${encodeURIComponent(code)}/`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: ['Mait', 'MPP'],
    }),

    /** Maits who already hold a login, newest first — who was activated, and to which number. */
    adminRecentMaitLogins: builder.query<Paginated<AdminUser>, void>({
      query: () => ({
        url: '/admin/users/',
        params: { role: 'mait', ordering: '-created_at', limit: 10 },
      }),
      providesTags: ['Mait'],
    }),

    /** One collection point, whole (GET /mpp/{id}/) — the detail behind a search result. */
    getMpp: builder.query<MPP, number>({
      query: id => `/mpp/${id}/`,
      providesTags: ['MPP'],
    }),

    /**
     * The field-registered farmers, for the back office (GET /admin/non-members/) — browsed
     * newest first, 25 to a page, narrowed by MPP and by the rows missing a face of the card.
     */
    adminListNonMembers: builder.query<
      Paginated<AdminNonMember>,
      { search?: string; mpp?: string; noCard?: boolean; offset?: number } | void
    >({
      query: args => ({
        url: '/admin/non-members/',
        params: {
          limit: 25,
          ...(args?.search ? { search: args.search } : {}),
          ...(args?.mpp ? { mpp__mpp_code: args.mpp } : {}),
          ...(args?.noCard ? { no_card: 'true' } : {}),
          ...(args?.offset ? { offset: args.offset } : {}),
        },
      }),
      providesTags: ['Member'],
    }),

    /**
     * One field-registered farmer, whole (GET /admin/non-members/{id}/) — the only response
     * carrying her card images, and the read is audit-logged against the operator.
     */
    adminGetNonMember: builder.query<AdminNonMemberDetail, number>({
      query: id => `/admin/non-members/${id}/`,
      providesTags: ['Member'],
    }),

    /**
     * Straw holding across every Mait, and every store shelf in reach (GET /admin/inventory/)
     * — the oversight screen. `zone` narrows it further for head office.
     */
    adminInventoryOversight: builder.query<InventoryOversight, { zone?: number } | void>({
      query: args => ({
        url: '/admin/inventory/',
        params: args?.zone ? { zone: args.zone } : {},
      }),
      providesTags: ['Inventory', 'Store'],
    }),

    /** One Mait's whole stock, and what it can be adjusted with (GET /admin/inventory/{id}/). */
    adminMaitStock: builder.query<MaitStockDetail, number>({
      query: id => `/admin/inventory/${id}/`,
      providesTags: ['Inventory'],
    }),

    /**
     * Add to or take off a Mait's stock from the office (POST /admin/inventory/{id}/) — a
     * manual adjustment, not an indent. Answers with the stock as it now stands.
     */
    adminAdjustMaitStock: builder.mutation<MaitStockDetail, { id: number } & MaitStockAdjustment>({
      query: ({ id, ...body }) => ({ url: `/admin/inventory/${id}/`, method: 'POST', body }),
      invalidatesTags: ['Inventory'],
    }),

    /** A store's shelf, and what it can be stocked with (GET /admin/stores/{id}/stock/). */
    adminStoreStock: builder.query<AdminStoreStock, number>({
      query: id => `/admin/stores/${id}/stock/`,
      providesTags: ['Store'],
    }),

    /**
     * A delivery (`receive`, adds) or a count (`count`, replaces) on a store's shelf
     * (POST /admin/stores/{id}/stock/).
     */
    adminUpdateStoreStock: builder.mutation<AdminStoreStock, { id: number } & StoreStockUpdate>({
      query: ({ id, ...body }) => ({ url: `/admin/stores/${id}/stock/`, method: 'POST', body }),
      invalidatesTags: ['Store', 'Inventory'],
    }),

    /**
     * The product catalogue with recovery rates (GET /admin/products/) — retired rows
     * included, because the screen can show them on request.
     */
    adminListProducts: builder.query<Paginated<ProductAdmin>, void>({
      query: () => ({ url: '/admin/products/', params: { limit: 200 } }),
      providesTags: ['Inventory'],
    }),

    // A catalogue change renames what an indent asks for and what a Mait's stock is counted
    // in, so it invalidates the stock screens and the breed picker along with the list.
    adminCreateProduct: builder.mutation<ProductAdmin, CatalogueWrite>({
      query: body => ({ url: '/admin/products/', method: 'POST', body }),
      invalidatesTags: ['Inventory', 'Store'],
    }),
    adminUpdateProduct: builder.mutation<ProductAdmin, { id: number } & CatalogueWrite>({
      query: ({ id, ...body }) => ({ url: `/admin/products/${id}/`, method: 'PATCH', body }),
      invalidatesTags: ['Inventory', 'Store'],
    }),
    adminDeleteProduct: builder.mutation<void, number>({
      query: id => ({ url: `/admin/products/${id}/`, method: 'DELETE' }),
      invalidatesTags: ['Inventory', 'Store'],
    }),

    /** The pregnancy diagnosis price — one pair of figures, not per breed. */
    adminPregnancyRate: builder.query<PregnancyRateConfig, void>({
      query: () => '/admin/pregnancy/rate/',
      providesTags: ['Pregnancy'],
    }),
    adminUpdatePregnancyRate: builder.mutation<
      PregnancyRateConfig,
      { member_rate?: number; non_member_rate?: number }
    >({
      query: body => ({ url: '/admin/pregnancy/rate/', method: 'PATCH', body }),
      invalidatesTags: ['Pregnancy'],
    }),

    /** The semen list — every breed, retired ones too (GET /admin/breeds/, unpaginated). */
    adminListBreeds: builder.query<AdminBreed[], void>({
      query: () => '/admin/breeds/',
      transformResponse: (body: AdminBreed[] | Paginated<AdminBreed>) =>
        Array.isArray(body) ? body : (body?.results ?? []),
      providesTags: ['Animal'],
    }),
    adminCreateBreed: builder.mutation<AdminBreed, CatalogueWrite>({
      query: body => ({ url: '/admin/breeds/', method: 'POST', body }),
      invalidatesTags: ['Animal', 'Inventory', 'Store'],
    }),
    adminUpdateBreed: builder.mutation<AdminBreed, { id: number } & CatalogueWrite>({
      query: ({ id, ...body }) => ({ url: `/admin/breeds/${id}/`, method: 'PATCH', body }),
      invalidatesTags: ['Animal', 'Inventory', 'Store'],
    }),
    adminDeleteBreed: builder.mutation<void, number>({
      query: id => ({ url: `/admin/breeds/${id}/`, method: 'DELETE' }),
      invalidatesTags: ['Animal', 'Inventory', 'Store'],
    }),

    /** Every store/depot for the admin roster (GET /admin/stores/). */
    // The server sends stores and zones as a plain array (pagination off), so both are
    // normalised to a page here — every screen reads `.results`.
    adminListStores: builder.query<Paginated<StoreAdmin>, { search?: string } | void>({
      query: args => ({
        url: '/admin/stores/',
        params: { limit: 100, ...(args?.search ? { search: args.search } : {}) },
      }),
      transformResponse: (body: StoreAdmin[] | Paginated<StoreAdmin>) => asPage(body),
      providesTags: ['Store'],
    }),

    /** Every BMC/MCC, and the store that serves it (GET /admin/stores/plants/). */
    adminStorePlants: builder.query<
      { count: number; unserved: number; results: StorePlantRow[] },
      void
    >({
      query: () => '/admin/stores/plants/',
      providesTags: ['Store'],
    }),
    adminCreateStore: builder.mutation<StoreAdmin, StoreWrite>({
      query: body => ({ url: '/admin/stores/', method: 'POST', body }),
      invalidatesTags: ['Store', 'Inventory', 'Indent'],
    }),
    adminUpdateStore: builder.mutation<StoreAdmin, { id: number } & StoreWrite>({
      query: ({ id, ...body }) => ({ url: `/admin/stores/${id}/`, method: 'PATCH', body }),
      invalidatesTags: ['Store', 'Inventory', 'Indent'],
    }),
    adminDeleteStore: builder.mutation<void, number>({
      query: id => ({ url: `/admin/stores/${id}/`, method: 'DELETE' }),
      invalidatesTags: ['Store', 'Inventory'],
    }),
    /** A keeper's account: a name and the number they sign in to the app with. */
    adminAddStoreKeeper: builder.mutation<
      StoreAdmin,
      { id: number; full_name: string; mobile_no: string }
    >({
      query: ({ id, ...body }) => ({ url: `/admin/stores/${id}/keepers/`, method: 'POST', body }),
      invalidatesTags: ['Store'],
    }),
    /** Take a keeper off a store. Their account stops signing in. */
    adminRemoveStoreKeeper: builder.mutation<StoreAdmin, { id: number; userId: number }>({
      query: ({ id, userId }) => ({
        url: `/admin/stores/${id}/keepers/${userId}/remove/`,
        method: 'POST',
        body: {},
      }),
      invalidatesTags: ['Store'],
    }),

    /**
     * The indent queue for the admin roster (GET /indents/) — by status, by a search over the
     * Mait, breed, store or indent number, and `stale=true` for the ones nobody is moving.
     */
    adminListIndents: builder.query<
      Paginated<Indent>,
      { status?: string; offset?: number; search?: string; stale?: boolean } | void
    >({
      query: args => ({
        url: '/indents/',
        params: {
          limit: 25,
          ...(args?.status ? { status: args.status } : {}),
          ...(args?.offset ? { offset: args.offset } : {}),
          ...(args?.search ? { search: args.search } : {}),
          ...(args?.stale ? { stale: 'true' } : {}),
        },
      }),
      providesTags: ['Indent'],
    }),

    /**
     * Issue an approved indent from the office (POST /indents/{id}/issue/) — only for a Mait
     * no store serves. Straw numbers when the depot slip lists them, else a quantity. Sets the
     * stock aside; it is the Mait's once they confirm collecting it.
     */
    adminIssueIndent: builder.mutation<
      Indent,
      { id: number; qty?: number; straw_numbers?: string[] }
    >({
      query: ({ id, ...body }) => ({ url: `/indents/${id}/issue/`, method: 'POST', body }),
      invalidatesTags: ['Indent', 'Zonal', 'Inventory', 'Store'],
    }),

    /** The Mait payment preview for a month (GET /reports/mait-payment/), bank details masked. */
    adminMaitPayment: builder.query<MaitPaymentReport, { month?: string } | void>({
      query: args => ({
        url: '/reports/mait-payment/',
        params: args?.month ? { month: args.month } : {},
      }),
      providesTags: ['Payment'],
    }),

    /**
     * Change the payout's four figures. Every month is computed on read, so this rebuilds them
     * all — the sheet is refetched rather than patched, never left under the old rates.
     */
    adminUpdatePayoutScheme: builder.mutation<PayoutScheme, Partial<PayoutScheme>>({
      query: body => ({ url: '/reports/mait-payment/scheme/', method: 'PATCH', body }),
      invalidatesTags: ['Payment'],
    }),

    /** The Mait leaderboard (GET /dashboard/mait-performance/), ranked by inseminations. */
    adminLeaderboard: builder.query<Leaderboard, { date_from?: string; date_to?: string } | void>({
      query: args => ({
        url: '/dashboard/mait-performance/',
        params: {
          ...(args?.date_from ? { date_from: args.date_from } : {}),
          ...(args?.date_to ? { date_to: args.date_to } : {}),
        },
      }),
    }),

    /**
     * The detail behind one Exceptions card. Failed OTPs keeps its own endpoint — deciding why
     * a code failed needs more than a row builder — but answers in the same row shape.
     */
    adminExceptionQueue: builder.query<
      ExceptionQueue,
      { queue: QueueName; filter?: string; days?: number }
    >({
      query: ({ queue, filter, days }) => {
        const params: Record<string, string | number> = {};
        if (filter) {
          params.filter = filter;
        }
        if (days) {
          params.days = days;
        }
        if (queue === 'failed-otps') {
          return { url: '/admin/otp-failures/', params: { ...params, limit: 200 } };
        }
        return { url: `/admin/exceptions/${queue}/`, params };
      },
      providesTags: ['Payment', 'Inventory', 'Indent', 'Pregnancy'],
    }),

    /** Pregnancy oversight across Maits (GET /admin/pregnancy/). */
    adminPregnancyOversight: builder.query<PregnancyOversight, void>({
      query: () => '/admin/pregnancy/',
      providesTags: ['Pregnancy'],
    }),

    /** One Mait's checks, behind a row of the oversight list (GET /admin/pregnancy/{id}/). */
    adminMaitPregnancyChecks: builder.query<
      MaitPregnancyChecks,
      { maitId: number; window: PregnancyWindow; limit?: number }
    >({
      query: ({ maitId, window, limit = 100 }) => ({
        url: `/admin/pregnancy/${maitId}/`,
        params: { window, limit },
      }),
      providesTags: ['Pregnancy'],
    }),

    /** The exception queues, read off the dashboard summary (GET /dashboard/summary/). */
    adminDashboardSummary: builder.query<DashboardSummary, void>({
      query: () => '/dashboard/summary/',
    }),

    /** AI events per day, for the dashboard chart (GET /dashboard/trends/). */
    adminDashboardTrends: builder.query<DashboardTrends, { days: number }>({
      query: ({ days }) => ({ url: '/dashboard/trends/', params: { granularity: 'daily', days } }),
    }),

    /** Each zone's share of the AI events over the same window (GET /dashboard/zones/). */
    adminZonePerformance: builder.query<ZonePerformance, { days: number }>({
      query: ({ days }) => ({ url: '/dashboard/zones/', params: { days } }),
    }),

    /** The payout scheme — commission, retainer and straw rate (GET /reports/mait-payment/scheme/). */
    adminPayoutScheme: builder.query<PayoutScheme, void>({
      query: () => '/reports/mait-payment/scheme/',
      providesTags: ['Payment'],
    }),

    /** The audit trail (GET /admin/audit/), newest first, filterable by one search box. */
    adminAuditTrail: builder.query<AuditTrail, (AuditQuery & { offset?: number }) | void>({
      query: args => {
        const params: Record<string, string | number> = { limit: 50 };
        for (const [key, value] of Object.entries(args ?? {})) {
          if (value) {
            params[key] = value;
          }
        }
        return { url: '/admin/audit/', params };
      },
    }),

    /**
     * Portal accounts (GET /admin/users/), 25 to a page, searched and filtered on the server —
     * the list is paged, so narrowing what arrived would hide matches on every other page.
     */
    adminListUsers: builder.query<
      Paginated<AdminUser>,
      { search?: string; role?: string; offset?: number } | void
    >({
      query: args => ({
        url: '/admin/users/',
        params: {
          limit: 25,
          ...(args?.search ? { search: args.search } : {}),
          ...(args?.role ? { role: args.role } : {}),
          ...(args?.offset ? { offset: args.offset } : {}),
        },
      }),
    }),

    /** Every section an Admin can be given, in sidebar order (GET /admin/users/portal-sections/). */
    adminPortalSections: builder.query<{ results: PortalSectionEntry[]; count: number }, void>({
      query: () => '/admin/users/portal-sections/',
    }),

    /**
     * Create an office account (POST /admin/users/). A Mait is never created here — they are
     * activated from their SAP record on the Maits screen.
     */
    adminCreateUser: builder.mutation<AdminUser, AdminUserCreate>({
      query: body => ({ url: '/admin/users/', method: 'POST', body }),
    }),

    /**
     * Change one account (PATCH /admin/users/{id}/) — only the fields sent. The answer is the
     * whole account, which the screen puts back into its row rather than reloading the page. A
     * Mait's login switched off shows on the Maits screen, so that list is refreshed too.
     */
    adminUpdateUser: builder.mutation<AdminUser, { id: number; body: AdminUserPatch }>({
      query: ({ id, body }) => ({ url: `/admin/users/${id}/`, method: 'PATCH', body }),
      // A zone or number given on Users & roles is a manager on Zones.
      invalidatesTags: ['Mait', 'Zone'],
    }),

    /** Zones (GET /admin/zones/) — each with how much of the network it holds. */
    adminListZones: builder.query<Paginated<Zone>, void>({
      query: () => ({ url: '/admin/zones/', params: { limit: 100 } }),
      transformResponse: (body: Zone[] | Paginated<Zone>) => asPage(body),
      providesTags: ['Zone'],
    }),

    /**
     * Every BMC/MCC in the master data, its size and the zone holding it (GET
     * /admin/zones/plants/) — what a zone is built from. Typed in nowhere: they arrive with SAP.
     */
    adminZonePlants: builder.query<
      { count: number; unassigned: number; results: ZonePlantRow[] },
      void
    >({
      query: () => '/admin/zones/plants/',
      providesTags: ['Zone'],
    }),

    /** Who runs the zones: number, app, and what they did in the window (GET .../managers/). */
    adminZoneManagers: builder.query<ZoneManagers, { days: number }>({
      query: ({ days }) => ({ url: '/admin/zones/managers/', params: { days } }),
      providesTags: ['Zone'],
    }),

    /**
     * What the managers have done (GET /admin/zones/activity/). `kind=decisions` drops sign-ins,
     * which otherwise bury the two approvals somebody came to read; `manager` narrows to one.
     */
    adminZoneActivity: builder.query<
      ZoneActivity,
      { days: number; kind: 'decisions' | 'all'; manager?: number | null }
    >({
      query: ({ days, kind, manager }) => ({
        url: '/admin/zones/activity/',
        params: { days, kind, ...(manager ? { manager } : {}) },
      }),
      providesTags: ['Zone'],
    }),

    /** Create a zone with the centres it covers (POST /admin/zones/). */
    adminCreateZone: builder.mutation<Zone, ZoneWrite>({
      query: body => ({ url: '/admin/zones/', method: 'POST', body }),
      invalidatesTags: ['Zone'],
    }),

    /** Amend a zone (PATCH /admin/zones/{id}/). `plants` is the whole membership, not an addition. */
    adminUpdateZone: builder.mutation<Zone, { id: number; body: ZoneWrite }>({
      query: ({ id, body }) => ({ url: `/admin/zones/${id}/`, method: 'PATCH', body }),
      invalidatesTags: ['Zone'],
    }),

    /** Delete a zone — refused by the server while any account still reads it. */
    adminDeleteZone: builder.mutation<void, number>({
      query: id => ({ url: `/admin/zones/${id}/`, method: 'DELETE' }),
      invalidatesTags: ['Zone'],
    }),

    /**
     * Set a zonal manager's number (PATCH /admin/zones/managers/{id}/) — the one thing this
     * screen writes about a person, and the thing that decides whether they have the app.
     */
    adminSetZoneManagerMobile: builder.mutation<ZoneManager, { id: number; mobile_no: string }>({
      query: ({ id, mobile_no }) => ({
        url: `/admin/zones/managers/${id}/`,
        method: 'PATCH',
        body: { mobile_no },
      }),
      invalidatesTags: ['Zone'],
    }),

    /**
     * The OTP pipeline (GET /admin/otp-pipeline/): every code through made → gateway accepted →
     * typed in → used, and the Super OTP asks with a verdict each — for information only. No
     * tag: the screen polls, as the portal does, because codes are sent all day.
     */
    adminOtpPipeline: builder.query<OtpPipeline, OtpPipelineQuery>({
      query: args => {
        const params: Record<string, string | number> = { limit: 25 };
        for (const [key, value] of Object.entries(args)) {
          if (value) {
            params[key] = value;
          }
        }
        return { url: '/admin/otp-pipeline/', params };
      },
    }),

    /**
     * Login codes (GET /admin/super-otp/) — the asks waiting and the live codes.
     *
     * A plain array, not a page (the server turns pagination off). `state=open` is what needs
     * the office, `all` is the last 200 of everything. No tag: the three writes below refetch
     * the list by hand, the way the Indents screen does, so a decision's effect is immediate
     * without a cache-invalidation web for one screen.
     */
    adminSuperOtpList: builder.query<SuperOtpRow[], { state?: 'open' | 'all' } | void>({
      query: args => ({ url: '/admin/super-otp/', params: { state: args?.state ?? 'open' } }),
    }),

    /**
     * Generate the code for an ask (POST /admin/super-otp/{id}/issue/).
     *
     * The one response that carries a plaintext code, and only this once — it is stored as a
     * hash and never returned again. The screen shows it, the admin reads it out, and it is
     * gone from the page the moment they dismiss it.
     */
    adminIssueSuperOtp: builder.mutation<SuperOtpIssued, number>({
      query: id => ({ url: `/admin/super-otp/${id}/issue/`, method: 'POST', body: {} }),
    }),

    /** A code for somebody who phoned the office rather than asking from the app. */
    adminIssueSuperOtpForNumber: builder.mutation<SuperOtpIssued, { mobileNo: string }>({
      query: ({ mobileNo }) => ({
        url: '/admin/super-otp/issue-for-number/',
        method: 'POST',
        body: { mobile_no: mobileNo },
      }),
    }),

    /**
     * A farmer-check code for a Mait with no signal, checked on her phone (accounts.field_codes).
     *
     * The office picks the Mait who rang and the farmer in front of them — a member by code, or
     * a non-member by number. Exactly one of `memberCode`/`farmerMobile`, as the portal's own
     * field-code card does; the server validates the same way. The response carries `code` once,
     * like every other issue here.
     */
    adminIssueFieldCode: builder.mutation<
      SuperOtpIssued,
      { mait: string; memberCode?: string; farmerMobile?: string; farmerName?: string }
    >({
      query: ({ mait, memberCode, farmerMobile, farmerName }) => ({
        url: '/admin/super-otp/field-code/',
        method: 'POST',
        body: {
          mait,
          member_code: memberCode ?? '',
          farmer_mobile: farmerMobile ?? '',
          farmer_name: farmerName ?? '',
        },
      }),
    }),

    /** Decline an ask, with the reason kept on the record (POST .../decline/). */
    adminDeclineSuperOtp: builder.mutation<SuperOtpRow, { id: number; reason: string }>({
      query: ({ id, reason }) => ({
        url: `/admin/super-otp/${id}/decline/`,
        method: 'POST',
        body: { reason },
      }),
    }),

    /** The SAP import history (GET /admin/uploads/), newest first — status and progress. */
    adminUploadHistory: builder.query<Paginated<UploadJob>, void>({
      query: () => ({ url: '/admin/uploads/', params: { limit: 25 } }),
      providesTags: ['Upload'],
    }),

    /**
     * The newest upload of one master, for the line under its card ("Last: 105,412 rows on
     * 12 Oct"). Asked per type rather than picked out of the history: a master must not read
     * "Never uploaded" because newer uploads of the other two pushed it off the first page.
     */
    adminLastUpload: builder.query<Paginated<UploadJob>, string>({
      query: uploadType => ({
        url: '/admin/uploads/',
        params: { upload_type: uploadType, limit: 1 },
      }),
      providesTags: ['Upload'],
    }),

    /**
     * The rows an import rejected, each with its spreadsheet row number (GET
     * /admin/uploads/{id}/errors/) — so the fix happens against the file the admin has open.
     */
    adminUploadErrors: builder.query<UploadErrorReport, number>({
      query: id => ({ url: `/admin/uploads/${id}/errors/` }),
    }),

    /** One import, polled while it runs (GET /admin/uploads/{id}/). */
    adminUploadStatus: builder.query<UploadJob, number>({
      query: id => ({ url: `/admin/uploads/${id}/` }),
    }),

    /** Which masters have a landed upload to hand back (GET /admin/uploads/snapshots/). */
    adminUploadSnapshots: builder.query<{ results: MasterSnapshot[] }, void>({
      query: () => ({ url: '/admin/uploads/snapshots/' }),
      providesTags: ['Upload'],
    }),

    /**
     * The coverage picture behind Assignment (GET /dashboard/mpp-coverage/): which points are
     * served, who holds each, and whether that Mait can sign in. `days` is the service window
     * the "served" figure is measured over.
     */
    adminMppCoverage: builder.query<MppCoverage, { days?: number } | void>({
      query: args => ({ url: '/dashboard/mpp-coverage/', params: { days: args?.days ?? 30 } }),
      providesTags: ['MPP'],
    }),
  }),
});

export const {
  useSendLoginOtpMutation,
  useVerifyLoginOtpMutation,
  useRequestSuperOtpMutation,
  useAskFarmerOfficeCodeMutation,
  useAskPaymentOfficeCodeMutation,
  useLogoutMutation,
  useGetCurrentUserQuery,
  useLazyGetCurrentUserQuery,
  useListMppsQuery,
  useListMembersQuery,
  useGetMemberQuery,
  useCheckFarmerIdentityMutation,
  useGetFarmerRosterQuery,
  useCreateNonMemberMutation,
  useListNonMembersQuery,
  useUploadNonMemberAadhaarMutation,
  useGetNonMemberQuery,
  useListBreedsQuery,
  useInitiatePaymentMutation,
  useVerifyPaymentOtpMutation,
  useAttachPaymentProofMutation,
  useSendFarmerOtpMutation,
  useVerifyFarmerOtpMutation,
  useGetInventorySummaryQuery,
  useListProductsQuery,
  useLazyValidateStrawQuery,
  useCreateAiEventMutation,
  useListAiEventsQuery,
  useGetAiEventQuery,
  useGetAiEventTimelineQuery,
  useListPregnancyChecksQuery,
  useGetPdRouteQuery,
  useRecordPregnancyCheckMutation,
  useCreateIndentMutation,
  useListIndentsQuery,
  useGetIndentQuery,
  useConfirmIndentCollectionMutation,
  useGetStoreHomeQuery,
  useListStoreIndentsQuery,
  useGetStoreIndentQuery,
  useIssueFromStoreMutation,
  useListStoreHandoversQuery,
  useListStoreHistoryQuery,
  useGetStoreHandoverQuery,
  useCancelStoreHandoverMutation,
  useNewHandoverCodeMutation,
  useGetStoreStockQuery,
  useGetStoreCatalogueQuery,
  useReceiveStoreStockMutation,
  useGetZonalHomeQuery,
  useGetZonalDashboardQuery,
  useListZonalApprovalsQuery,
  useGetZoneStockQuery,
  useGetZonalHistoryQuery,
  useGetZonalEventQuery,
  useListZonalEventsQuery,
  useApproveIndentMutation,
  useRejectIndentMutation,
  useListZonalMaitsQuery,
  useLazyListZonalMaitsQuery,
  useZonalLookupQuery,
  useAssignZonalMppMutation,
  usePasswordLoginMutation,
  usePasswordResetRequestMutation,
  usePasswordResetVerifyMutation,
  useAdminListAiEventsQuery,
  useDeleteAiEventMutation,
  useBulkDeleteAiEventsMutation,
  useOfficeCompleteAiEventMutation,
  useAdminSearchMembersQuery,
  useAdminListMaitsQuery,
  useAdminListMembersQuery,
  useRevealMemberAadhaarMutation,
  useMemberMobileHistoryQuery,
  useChangeMemberMobileMutation,
  useAdminPendingMaitsQuery,
  useAdminActivateMaitMutation,
  useAdminUpdateMaitMutation,
  useAdminRecentMaitLoginsQuery,
  useGetMppQuery,
  useAdminListNonMembersQuery,
  useAdminGetNonMemberQuery,
  useAdminInventoryOversightQuery,
  useAdminMaitStockQuery,
  useAdminAdjustMaitStockMutation,
  useAdminStoreStockQuery,
  useAdminUpdateStoreStockMutation,
  useAdminListProductsQuery,
  useAdminCreateProductMutation,
  useAdminUpdateProductMutation,
  useAdminDeleteProductMutation,
  useAdminListBreedsQuery,
  useAdminPregnancyRateQuery,
  useAdminUpdatePregnancyRateMutation,
  useAdminCreateBreedMutation,
  useAdminUpdateBreedMutation,
  useAdminDeleteBreedMutation,
  useAdminListStoresQuery,
  useAdminStorePlantsQuery,
  useAdminCreateStoreMutation,
  useAdminUpdateStoreMutation,
  useAdminDeleteStoreMutation,
  useAdminAddStoreKeeperMutation,
  useAdminRemoveStoreKeeperMutation,
  useAdminListIndentsQuery,
  useAdminIssueIndentMutation,
  useAdminMaitPaymentQuery,
  useAdminUpdatePayoutSchemeMutation,
  useAdminLeaderboardQuery,
  useAdminPregnancyOversightQuery,
  useAdminExceptionQueueQuery,
  useAdminMaitPregnancyChecksQuery,
  useAdminDashboardSummaryQuery,
  useAdminDashboardTrendsQuery,
  useAdminZonePerformanceQuery,
  useAdminPayoutSchemeQuery,
  useAdminAuditTrailQuery,
  useAdminListUsersQuery,
  useAdminPortalSectionsQuery,
  useAdminCreateUserMutation,
  useAdminUpdateUserMutation,
  useAdminListZonesQuery,
  useAdminZonePlantsQuery,
  useAdminZoneManagersQuery,
  useAdminZoneActivityQuery,
  useAdminCreateZoneMutation,
  useAdminUpdateZoneMutation,
  useAdminDeleteZoneMutation,
  useAdminSetZoneManagerMobileMutation,
  useAdminSuperOtpListQuery,
  useAdminOtpPipelineQuery,
  useAdminIssueSuperOtpMutation,
  useAdminIssueSuperOtpForNumberMutation,
  useAdminIssueFieldCodeMutation,
  useAdminDeclineSuperOtpMutation,
  useAdminUploadHistoryQuery,
  useAdminLastUploadQuery,
  useAdminUploadStatusQuery,
  useAdminUploadErrorsQuery,
  useAdminUploadSnapshotsQuery,
  useAdminMppCoverageQuery,
} = maitaiApi;
