/**
 * The single MSAL instance. Kept out of providers.tsx so that module only
 * exports components (React Fast Refresh requirement).
 */

import { PublicClientApplication } from '@azure/msal-browser';

import { msalConfig } from '@/services/auth/msalConfig';

export const msalInstance = new PublicClientApplication(msalConfig);
