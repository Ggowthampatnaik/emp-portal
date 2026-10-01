/** Auth API calls, kept separate from the Redux slice that orchestrates them. */

import { http } from '@/services/api/client';
import { endpoints } from '@/services/api/endpoints';
import { tokenStorage } from '@/services/auth/tokenStorage';
import type { CurrentUser, EntraExchangeResponse, LoginCredentials } from '@/types/auth';

export const authService = {
  /** Email + password sign-in; returns the portal JWT pair and the user. */
  login: (credentials: LoginCredentials) =>
    http.post<EntraExchangeResponse>(endpoints.auth.login, credentials),

  /** Trades a validated Entra ID access token for the portal JWT pair. */
  exchangeEntraToken: (entraAccessToken: string) =>
    http.post<EntraExchangeResponse>(endpoints.auth.entraExchange, undefined, {
      headers: { Authorization: `Bearer ${entraAccessToken}` },
    }),

  fetchCurrentUser: () => http.get<CurrentUser>(endpoints.auth.me),

  changePassword: (currentPassword: string, newPassword: string) =>
    http.post<void>(endpoints.auth.passwordChange, {
      current_password: currentPassword,
      new_password: newPassword,
    }),

  /**
   * Asks for a temporary password by email.
   *
   * Always resolves, whatever the address: the server answers 204 either way so
   * that nobody can use this to find out who has an account here. The UI must
   * say the same thing in both cases.
   */
  forgotPassword: (email: string) => http.post<void>(endpoints.auth.passwordForgot, { email }),

  /**
   * Signs out, and hands over the refresh token so the server can retire it.
   *
   * Dropping the browser's copy is not enough: anything else holding that
   * token could keep minting access tokens from it until it expired. Sent even
   * when it is missing - the endpoint records the sign-out either way.
   */
  logout: () =>
    http.post<void>(endpoints.auth.logout, { refresh: tokenStorage.getRefresh() ?? '' }),
};
