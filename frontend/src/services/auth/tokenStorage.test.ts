/**
 * Where the session lives, and for how long.
 *
 * The point of "remember me" is that the session survives closing the browser,
 * which sessionStorage cannot do — so the choice decides the store. The thing
 * worth guarding is that only ever *one* store holds a pair: a copy left behind
 * in localStorage would quietly resurrect a session the person thought they had
 * ended by closing the tab.
 */

import { describe, expect, it } from 'vitest';

import { rememberedEmail, tokenStorage } from '@/services/auth/tokenStorage';

const PAIR = { access: 'access-token', refresh: 'refresh-token' };

describe('tokenStorage', () => {
  it('keeps an ordinary session in sessionStorage, where it dies with the tab', () => {
    tokenStorage.set(PAIR);

    expect(sessionStorage.getItem('empportal.access')).toBe('access-token');
    expect(localStorage.getItem('empportal.access')).toBeNull();
    expect(tokenStorage.isRemembered()).toBe(false);
  });

  it('puts a remembered session in localStorage, where it outlives the browser', () => {
    tokenStorage.set(PAIR, true);

    expect(localStorage.getItem('empportal.access')).toBe('access-token');
    expect(sessionStorage.getItem('empportal.access')).toBeNull();
    expect(tokenStorage.isRemembered()).toBe(true);
  });

  it('reads back whichever store the session went into', () => {
    tokenStorage.set(PAIR, true);
    expect(tokenStorage.get()).toEqual(PAIR);

    tokenStorage.set(PAIR, false);
    expect(tokenStorage.get()).toEqual(PAIR);
  });

  it('moves the session rather than leaving a copy behind', () => {
    tokenStorage.set(PAIR, true);
    tokenStorage.set({ access: 'new-access', refresh: 'new-refresh' }, false);

    expect(localStorage.getItem('empportal.access')).toBeNull();
    expect(localStorage.getItem('empportal.refresh')).toBeNull();
    expect(sessionStorage.getItem('empportal.access')).toBe('new-access');
    expect(tokenStorage.isRemembered()).toBe(false);
  });

  it('refreshes the access token into the store already in play', () => {
    tokenStorage.set(PAIR, true);
    tokenStorage.setAccess('refreshed');

    expect(localStorage.getItem('empportal.access')).toBe('refreshed');
    expect(sessionStorage.getItem('empportal.access')).toBeNull();
    expect(tokenStorage.getAccess()).toBe('refreshed');
  });

  it('signing out empties both stores', () => {
    tokenStorage.set(PAIR, true);
    tokenStorage.clear();

    expect(tokenStorage.get()).toBeNull();
    expect(localStorage.getItem('empportal.refresh')).toBeNull();
    expect(sessionStorage.getItem('empportal.refresh')).toBeNull();
    expect(tokenStorage.isRemembered()).toBe(false);
  });

  it('does not forget the address on sign-out — it is not a credential', () => {
    rememberedEmail.set('asha.rao@trigyan.io');
    tokenStorage.clear();

    expect(rememberedEmail.get()).toBe('asha.rao@trigyan.io');
  });
});
