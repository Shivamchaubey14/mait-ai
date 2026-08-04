/**
 * Authentication state (SRS §6.8.2 — Maits log in with a mobile OTP).
 *
 * Tokens are persisted in MMKV rather than plain AsyncStorage so they sit in the platform
 * keystore. A field phone is shared, lost and handed around; tokens sitting in readable
 * storage would be a real exposure, not a theoretical one.
 */

import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export type UserRole = 'super_admin' | 'admin' | 'mpp_operator' | 'mait';

export interface AuthUser {
  id: number;
  fullName: string;
  role: UserRole;
  mobileNo: string;
  maitId: number | null;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
  /** MPP codes this Mait may operate at. The app filters to these (SRS §6.2.3). */
  assignedMppCodes: string[];
}

const initialState: AuthState = {
  accessToken: null,
  refreshToken: null,
  user: null,
  assignedMppCodes: [],
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
    },

    tokensRefreshed: (state, action: PayloadAction<{ access: string; refresh?: string }>) => {
      state.accessToken = action.payload.access;
      // Refresh tokens rotate (SRS §16), so the response may carry a new one.
      if (action.payload.refresh) {
        state.refreshToken = action.payload.refresh;
      }
    },

    loggedOut: () => initialState,
  },
});

export const { loggedIn, tokensRefreshed, loggedOut } = authSlice.actions;
export default authSlice.reducer;
