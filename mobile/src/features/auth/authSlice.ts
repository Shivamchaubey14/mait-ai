/**
 * Authentication state (SRS §6.8.2 — Maits log in with a mobile OTP).
 *
 * Mirrored into expo-secure-store by the persistence middleware, so a restart does not sign
 * a Mait out mid-round. A field phone is shared, lost and handed around, which is why it is
 * secure-store rather than plain storage — see `session.ts`.
 */

import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export type UserRole = 'super_admin' | 'admin' | 'mait';

export interface AuthUser {
  id: number;
  fullName: string;
  role: UserRole;
  mobileNo: string;
  maitId: number | null;
  /**
   * The Sahayak vendor code — what a Mait is known by everywhere else.
   *
   * Not the same thing as `maitId`, which is a row id and means nothing outside this
   * database. Home used to print that row id under a "MAIT" label, so a Mait signing in with
   * their mobile number was shown a number that matches nothing on their paperwork, in the
   * portal, or in SAP.
   */
  sahayakVendorCode: string | null;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
  /** MPP codes this Mait may operate at. The app filters to these (SRS §6.2.3). */
  assignedMppCodes: string[];
  /**
   * False until the stored session has been read.
   *
   * Without it the app renders the login screen for a frame on every cold start, which reads
   * as having been signed out — the exact thing this persistence exists to prevent.
   */
  restored: boolean;
}

const initialState: AuthState = {
  accessToken: null,
  refreshToken: null,
  user: null,
  assignedMppCodes: [],
  restored: false,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    loggedIn: (
      state,
      action: PayloadAction<{
        access: string;
        refresh: string;
        user: AuthUser;
        assignedMppCodes: string[];
      }>,
    ) => {
      state.accessToken = action.payload.access;
      state.refreshToken = action.payload.refresh;
      state.user = action.payload.user;
      state.assignedMppCodes = action.payload.assignedMppCodes;
      state.restored = true;
    },

    /**
     * Rehydrate from secure storage at launch.
     *
     * A null payload means there was nothing stored — still a completed restore, so the app
     * stops waiting and shows the login screen.
     */
    sessionRestored: (
      state,
      action: PayloadAction<{
        access: string;
        refresh: string;
        user: AuthUser;
        assignedMppCodes: string[];
      } | null>,
    ) => {
      state.restored = true;
      if (!action.payload) {
        return;
      }
      state.accessToken = action.payload.access;
      state.refreshToken = action.payload.refresh;
      state.user = action.payload.user;
      state.assignedMppCodes = action.payload.assignedMppCodes;
    },

    tokensRefreshed: (state, action: PayloadAction<{ access: string; refresh?: string }>) => {
      state.accessToken = action.payload.access;
      // Refresh tokens rotate (SRS §16), so the response may carry a new one.
      if (action.payload.refresh) {
        state.refreshToken = action.payload.refresh;
      }
    },

    loggedOut: () => ({ ...initialState, restored: true }),
  },
});

export const { loggedIn, tokensRefreshed, sessionRestored, loggedOut } = authSlice.actions;
export default authSlice.reducer;
