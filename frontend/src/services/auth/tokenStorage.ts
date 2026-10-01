/**
 * Portal JWT storage.
 *
 * sessionStorage by default: the tokens die with the tab, which keeps the blast
 * radius of an XSS smaller than localStorage while still surviving a refresh.
 *
 * "Remember me" is the deliberate trade the other way. A session that cannot
 * outlive the browser is not worth remembering, so those tokens go to
 * localStorage instead — which is a wider exposure, chosen knowingly by the
 * person ticking the box rather than imposed on everyone. Only one store ever
 * holds a pair, so ticking or unticking the box on a later sign-in moves the
 * session rather than leaving a stale copy behind.
 */

import type { TokenPair } from '@/types/auth';

const ACCESS_KEY = 'empportal.access';
const REFRESH_KEY = 'empportal.refresh';
const REMEMBER_KEY = 'empportal.remember';
const EMAIL_KEY = 'empportal.email';

/** Which store the live session is in. */
function current(): Storage {
  return localStorage.getItem(REMEMBER_KEY) === '1' ? localStorage : sessionStorage;
}

export const tokenStorage = {
  get(): TokenPair | null {
    const store = current();
    const access = store.getItem(ACCESS_KEY);
    const refresh = store.getItem(REFRESH_KEY);
    return access && refresh ? { access, refresh } : null;
  },

  getAccess(): string | null {
    return current().getItem(ACCESS_KEY);
  },

  getRefresh(): string | null {
    return current().getItem(REFRESH_KEY);
  },

  set(tokens: TokenPair, remember = false): void {
    // Clear first, so a session never exists in both stores at once.
    this.clear();
    if (remember) localStorage.setItem(REMEMBER_KEY, '1');
    const store = remember ? localStorage : sessionStorage;
    store.setItem(ACCESS_KEY, tokens.access);
    store.setItem(REFRESH_KEY, tokens.refresh);
  },

  /** Used by the refresh interceptor; stays in whichever store is in play. */
  setAccess(access: string): void {
    current().setItem(ACCESS_KEY, access);
  },

  /** True when this session was asked to outlive the browser. */
  isRemembered(): boolean {
    return localStorage.getItem(REMEMBER_KEY) === '1';
  },

  clear(): void {
    for (const store of [sessionStorage, localStorage]) {
      store.removeItem(ACCESS_KEY);
      store.removeItem(REFRESH_KEY);
    }
    localStorage.removeItem(REMEMBER_KEY);
  },
};

/**
 * The email to put back in the form next time.
 *
 * Kept apart from the tokens: it outlives sign-out on purpose, and it is not a
 * credential — forgetting it is a nuisance, leaking it is not a breach.
 */
export const rememberedEmail = {
  get(): string {
    return localStorage.getItem(EMAIL_KEY) ?? '';
  },

  set(email: string): void {
    localStorage.setItem(EMAIL_KEY, email);
  },

  clear(): void {
    localStorage.removeItem(EMAIL_KEY);
  },
};
