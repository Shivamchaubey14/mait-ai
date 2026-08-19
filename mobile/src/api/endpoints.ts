/**
 * RTK Query endpoint definitions (docs/API_CONTRACT.md §9.1, §9.3).
 *
 * Injected into the base client rather than declared alongside it, so each feature owns its
 * own slice and `client.ts` never becomes a dumping ground.
 */

import { api, idempotencyHeaders } from './client';
import type {
  AadhaarImages,
  AIEvent,
  AIEventDraft,
  AIEventTimelineEntry,
  Animal,
  AnimalDraft,
  AnimalTypeCode,
  BreedConfig,
  CurrentUser,
  FarmerKey,
  Payment,
  FarmerOtpSent,
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
  Paginated,
  StrawValidation,
  TokenPair,
} from './types';

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
      query: body => ({ url: '/farmers/otp/send/', method: 'POST', body }),
    }),

    verifyFarmerOtp: builder.mutation<{ verified: boolean }, FarmerKey & { otp: string }>({
      query: body => ({ url: '/farmers/otp/verify/', method: 'POST', body }),
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
      }),
      invalidatesTags: ['Payment', 'AIEvent'],
    }),

    verifyPaymentOtp: builder.mutation<Payment, { eventId: number; otp: string }>({
      query: ({ eventId, otp }) => ({
        url: `/payments/${eventId}/otp/verify/`,
        method: 'POST',
        body: { otp },
      }),
      invalidatesTags: ['Payment', 'AIEvent'],
    }),

    createAnimal: builder.mutation<Animal, AnimalDraft>({
      query: body => ({ url: '/animals/', method: 'POST', body }),
      // The farmer's animal list hangs off their detail record, so that is what goes stale.
      invalidatesTags: ['Animal', 'Member'],
    }),

    /**
     * Her portrait, sent after she has been registered.
     *
     * A second call rather than part of the first: the animal has to exist even if the upload
     * dies on a village connection, because the capture flow is already standing on her id.
     * A Mait who loses the photo has an animal with no picture; one who loses the animal has
     * to start the step again with the farmer waiting.
     */
    uploadAnimalPhoto: builder.mutation<Animal, { id: number; uri: string }>({
      query: ({ id, uri }) => {
        const form = new FormData();
        form.append('photo', { uri, name: 'animal.jpg', type: 'image/jpeg' } as unknown as Blob);
        return { url: `/animals/${id}/photo/`, method: 'PATCH', body: form };
      },
      invalidatesTags: ['Animal', 'Member'],
    }),

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
      invalidatesTags: ['AIEvent'],
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
     * `Inventory` goes stale the moment it lands.
     */
    confirmIndentCollection: builder.mutation<Indent, number>({
      query: id => ({ url: `/indents/${id}/confirm-collection/`, method: 'POST' }),
      invalidatesTags: ['Indent', 'Inventory'],
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
      { status?: string; unfinished?: boolean } | void
    >({
      query: args => ({
        url: '/ai-events/',
        params: {
          ...(args?.status ? { status: args.status } : {}),
          ...(args?.unfinished ? { unfinished: true, limit: 50 } : {}),
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
    getAiEvent: builder.query<AIEvent, number>({
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
  }),
});

export const {
  useSendLoginOtpMutation,
  useVerifyLoginOtpMutation,
  useLogoutMutation,
  useGetCurrentUserQuery,
  useLazyGetCurrentUserQuery,
  useListMppsQuery,
  useListMembersQuery,
  useGetMemberQuery,
  useCreateNonMemberMutation,
  useListNonMembersQuery,
  useUploadNonMemberAadhaarMutation,
  useGetNonMemberQuery,
  useListBreedsQuery,
  useCreateAnimalMutation,
  useInitiatePaymentMutation,
  useVerifyPaymentOtpMutation,
  useUploadAnimalPhotoMutation,
  useSendFarmerOtpMutation,
  useVerifyFarmerOtpMutation,
  useGetInventorySummaryQuery,
  useListProductsQuery,
  useLazyValidateStrawQuery,
  useCreateAiEventMutation,
  useListAiEventsQuery,
  useGetAiEventQuery,
  useGetAiEventTimelineQuery,
  useCreateIndentMutation,
  useListIndentsQuery,
  useGetIndentQuery,
  useConfirmIndentCollectionMutation,
} = maitaiApi;
