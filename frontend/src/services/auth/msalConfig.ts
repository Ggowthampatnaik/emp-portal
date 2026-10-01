/**
 * Microsoft Entra ID (MSAL) configuration.
 *
 * The SPA acquires an Entra access token for the backend API scope, then trades
 * it once at /auth/entra/exchange/ for the portal JWT pair. Tokens live in
 * sessionStorage so closing the tab ends the session.
 */

import { LogLevel, type Configuration, type PopupRequest } from '@azure/msal-browser';

const clientId = import.meta.env.VITE_ENTRA_CLIENT_ID ?? '';
const tenantId = import.meta.env.VITE_ENTRA_TENANT_ID ?? '';
const apiScope = import.meta.env.VITE_ENTRA_API_SCOPE ?? '';

export const isSsoConfigured = Boolean(clientId && tenantId && apiScope);

/**
 * Whether the email/password form is offered. Set VITE_PASSWORD_SIGN_IN=false
 * once SSO is live - the backend refuses passwords then too, so this only stops
 * showing a form that cannot work. Without SSO there is no other way in, so the
 * form always shows. `?local=1` on /login still reveals it for break-glass use.
 */
export const isPasswordSignInEnabled =
  !isSsoConfigured || import.meta.env.VITE_PASSWORD_SIGN_IN !== 'false';

export const msalConfig: Configuration = {
  auth: {
    clientId,
    authority: `https://login.microsoftonline.com/${tenantId}`,
    redirectUri: import.meta.env.VITE_ENTRA_REDIRECT_URI ?? window.location.origin,
    postLogoutRedirectUri: window.location.origin,
    navigateToLoginRequestUrl: false,
  },
  cache: {
    cacheLocation: 'sessionStorage',
    storeAuthStateInCookie: false,
  },
  system: {
    loggerOptions: {
      logLevel: import.meta.env.DEV ? LogLevel.Warning : LogLevel.Error,
      piiLoggingEnabled: false,
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) return;
        if (level === LogLevel.Error) console.error('[msal]', message);
      },
    },
  },
};

/** Scopes requested at sign-in. */
export const loginRequest: PopupRequest = {
  scopes: ['openid', 'profile', 'email', apiScope].filter(Boolean),
  // A shared desk machine must not sign the next person in as the last one.
  prompt: 'select_account',
};

/** Scope used for silent token refresh against the portal API. */
export const apiTokenRequest = {
  scopes: [apiScope].filter(Boolean),
};
