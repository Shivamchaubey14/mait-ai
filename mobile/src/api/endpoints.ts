/**
 * RTK Query endpoint definitions (docs/API_CONTRACT.md §9.1, §9.3).
 *
 * Injected into the base client rather than declared alongside it, so each feature owns its
 * own slice and `client.ts` never becomes a dumping ground.
 */

import { api, idempotencyHeaders } from './client';
import type {
  AIEvent,
  AIEventDraft,
  Animal,
  AnimalDraft,
  AnimalTypeCode,
  BreedConfig,
  CurrentUser,
  InventorySummary,
  Member,
  MemberDetail,
  MPP,
  NonMember,
  NonMemberDetail,
  NonMemberDraft,
  Indent,
  IndentDraft,
  Paginated,
  StrawValidation,
  TokenPair,
} from './types';

export const maitaiApi = api.injectEndpoints({
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

    getNonMember: builder.query<NonMemberDetail, number>({
      query: id => `/non-members/${id}/`,
      providesTags: ['Member', 'Animal'],
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

    createAnimal: builder.mutation<Animal, AnimalDraft>({
      query: body => ({ url: '/animals/', method: 'POST', body }),
      // The farmer's animal list hangs off their detail record, so that is what goes stale.
      invalidatesTags: ['Animal', 'Member'],
    }),

    // ---- inventory -----------------------------------------------------------------
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
    validateStraw: builder.query<StrawValidation, string>({
      query: uniqueNo => `/semen-batches/${encodeURIComponent(uniqueNo)}/validate/`,
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

    listAiEvents: builder.query<Paginated<AIEvent>, { status?: string } | void>({
      query: args => ({
        url: '/ai-events/',
        params: args?.status ? { status: args.status } : undefined,
      }),
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
  useGetNonMemberQuery,
  useListBreedsQuery,
  useCreateAnimalMutation,
  useGetInventorySummaryQuery,
  useLazyValidateStrawQuery,
  useCreateAiEventMutation,
  useListAiEventsQuery,
  useCreateIndentMutation,
  useListIndentsQuery,
} = maitaiApi;
