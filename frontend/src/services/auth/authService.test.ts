/**
 * Signing out hands the refresh token back.
 *
 * Clearing the browser's copy is not signing out: anything else holding that
 * token could keep minting access tokens from it until it expired. The server
 * can only retire the token it is given, so this pins that it is given one -
 * and that a client which has lost it can still sign out.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { http } from '@/services/api/client';
import { endpoints } from '@/services/api/endpoints';
import { authService } from '@/services/auth/authService';
import { tokenStorage } from '@/services/auth/tokenStorage';

describe('authService.logout', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    tokenStorage.clear();
  });

  it('sends the refresh token so the server can retire it', async () => {
    const post = vi.spyOn(http, 'post').mockResolvedValue(undefined as never);
    tokenStorage.set({ access: 'access-token', refresh: 'refresh-token' });

    await authService.logout();

    expect(post).toHaveBeenCalledWith(endpoints.auth.logout, { refresh: 'refresh-token' });
  });

  it('still signs out when there is no token to hand back', async () => {
    const post = vi.spyOn(http, 'post').mockResolvedValue(undefined as never);

    await authService.logout();

    // Empty rather than omitted: the endpoint records the sign-out either way,
    // and a client stuck in a session it cannot leave is the worse failure.
    expect(post).toHaveBeenCalledWith(endpoints.auth.logout, { refresh: '' });
  });
});
