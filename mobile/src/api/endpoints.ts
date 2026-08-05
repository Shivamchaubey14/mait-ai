/**
 * RTK Query endpoint definitions (docs/API_CONTRACT.md §9.1, §9.3).
 *
 * Injected into the base client rather than declared alongside it, so each feature owns its
 * own slice and `client.ts` never becomes a dumping ground.
 */

import { api } from './client';
import type {
  CurrentUser,
  Member,
  MemberDetail,
  MPP,
  NonMember,
  NonMemberDraft,
  Paginated,
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

    getCurrentUser: builder.query<CurrentUser, void>({
      query: () => '/auth/me/',
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
} = maitaiApi;
