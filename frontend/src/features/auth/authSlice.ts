/**
 * Auth slice - the single source of truth for who is signed in and what they
 * may do. Route guards and the sidebar read from here; nothing else stores
 * roles or permissions.
 */

import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit';

import { toApiError } from '@/services/api/client';
import { authService } from '@/services/auth/authService';
import { isSsoConfigured } from '@/services/auth/msalConfig';
import { msalInstance } from '@/services/auth/msalInstance';
import { rememberedEmail, tokenStorage } from '@/services/auth/tokenStorage';
import type { CurrentUser, PermissionCode, RoleSlug, SignInRequest } from '@/types/auth';
import { PRIVILEGED_ROLES, ROLES } from '@/types/auth';

export type AuthStatus = 'idle' | 'authenticating' | 'authenticated' | 'error';

export interface AuthState {
  user: CurrentUser | null;
  status: AuthStatus;
  error: string | null;
  /** True while the app restores an existing session on first paint. */
  initialising: boolean;
}

const initialState: AuthState = {
  user: null,
  status: 'idle',
  error: null,
  initialising: true,
};

/** Completes SSO: Entra token in, portal session out. */
export const signInWithEntraToken = createAsyncThunk<
  CurrentUser,
  { entraAccessToken: string; remember?: boolean },
  { rejectValue: string }
>('auth/signInWithEntraToken', async ({ entraAccessToken, remember }, { rejectWithValue }) => {
  try {
    const response = await authService.exchangeEntraToken(entraAccessToken);
    tokenStorage.set({ access: response.access, refresh: response.refresh }, remember);
    return response.user;
  } catch (error) {
    return rejectWithValue(toApiError(error).message);
  }
});

/** Email + password sign-in. */
export const signIn = createAsyncThunk<CurrentUser, SignInRequest, { rejectValue: string }>(
  'auth/signIn',
  async ({ remember = false, ...credentials }, { rejectWithValue }) => {
    try {
      const response = await authService.login(credentials);
      tokenStorage.set({ access: response.access, refresh: response.refresh }, remember);
      // Only worth putting back in the form if they asked to be remembered.
      if (remember) rememberedEmail.set(credentials.email);
      else rememberedEmail.clear();
      return response.user;
    } catch (error) {
      return rejectWithValue(toApiError(error).message);
    }
  },
);

/** Restores the session on reload when a portal token is still in storage. */
export const restoreSession = createAsyncThunk<
  CurrentUser | null,
  void,
  { rejectValue: string }
>('auth/restoreSession', async (_, { rejectWithValue }) => {
  if (!tokenStorage.getAccess()) return null;
  try {
    return await authService.fetchCurrentUser();
  } catch (error) {
    tokenStorage.clear();
    return rejectWithValue(toApiError(error).message);
  }
});

export const signOut = createAsyncThunk<void>('auth/signOut', async () => {
  try {
    await authService.logout();
  } finally {
    tokenStorage.clear();
    // Forget the Microsoft account cached in this tab as well. The Microsoft
    // session itself is left alone - signing out of the portal should not
    // sign anyone out of Outlook or Teams.
    if (isSsoConfigured) await msalInstance.clearCache().catch(() => undefined);
  }
});

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    /** Fired by the axios interceptor when a refresh fails. */
    sessionExpired(state) {
      state.user = null;
      state.status = 'idle';
      state.error = 'Your session has expired. Please sign in again.';
      state.initialising = false;
    },
    /**
     * Drops the session without calling the API.
     *
     * Used after a password change, where the server has already retired every
     * token for the account: POSTing /logout would answer 401 and the
     * interceptor would report a session expiry over the top of a perfectly
     * successful change.
     */
    signedOutLocally(state) {
      tokenStorage.clear();
      state.user = null;
      state.status = 'idle';
      state.error = null;
      state.initialising = false;
    },
    clearAuthError(state) {
      state.error = null;
    },
    setUser(state, action: PayloadAction<CurrentUser>) {
      state.user = action.payload;
      state.status = 'authenticated';
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(signInWithEntraToken.pending, (state) => {
        state.status = 'authenticating';
        state.error = null;
      })
      .addCase(signInWithEntraToken.fulfilled, (state, action) => {
        state.user = action.payload;
        state.status = 'authenticated';
        state.initialising = false;
      })
      .addCase(signInWithEntraToken.rejected, (state, action) => {
        state.user = null;
        state.status = 'error';
        state.error = action.payload ?? 'Sign-in failed.';
        state.initialising = false;
      })
      .addCase(signIn.pending, (state) => {
        state.status = 'authenticating';
        state.error = null;
      })
      .addCase(signIn.fulfilled, (state, action) => {
        state.user = action.payload;
        state.status = 'authenticated';
        state.initialising = false;
      })
      .addCase(signIn.rejected, (state, action) => {
        state.user = null;
        state.status = 'error';
        state.error = action.payload ?? 'Sign-in failed.';
        state.initialising = false;
      })
      .addCase(restoreSession.pending, (state) => {
        state.initialising = true;
      })
      .addCase(restoreSession.fulfilled, (state, action) => {
        state.user = action.payload;
        state.status = action.payload ? 'authenticated' : 'idle';
        state.initialising = false;
      })
      .addCase(restoreSession.rejected, (state) => {
        state.user = null;
        state.status = 'idle';
        state.initialising = false;
      })
      .addCase(signOut.fulfilled, (state) => {
        state.user = null;
        state.status = 'idle';
        state.error = null;
        state.initialising = false;
      });
  },
});

export const { sessionExpired, signedOutLocally, clearAuthError, setUser } = authSlice.actions;
export default authSlice.reducer;

// --- selectors -------------------------------------------------------------
interface WithAuth {
  auth: AuthState;
}

export const selectCurrentUser = (state: WithAuth) => state.auth.user;
export const selectAuthStatus = (state: WithAuth) => state.auth.status;
export const selectAuthError = (state: WithAuth) => state.auth.error;
export const selectIsInitialising = (state: WithAuth) => state.auth.initialising;
export const selectIsAuthenticated = (state: WithAuth) => state.auth.user !== null;

export const selectRoles = (state: WithAuth): RoleSlug[] => state.auth.user?.roles ?? [];

export const selectHasRole =
  (...roles: RoleSlug[]) =>
  (state: WithAuth): boolean => {
    const owned = state.auth.user?.roles ?? [];
    if (owned.includes(ROLES.SUPER_ADMIN)) return true;
    return roles.some((role) => owned.includes(role));
  };

export const selectHasPermission =
  (...codes: PermissionCode[]) =>
  (state: WithAuth): boolean => {
    const user = state.auth.user;
    if (!user) return false;
    if (user.roles.includes(ROLES.SUPER_ADMIN)) return true;
    return codes.every((code) => user.permissions.includes(code));
  };

export const selectIsPrivileged = (state: WithAuth): boolean =>
  (state.auth.user?.roles ?? []).some((role) => PRIVILEGED_ROLES.includes(role));
