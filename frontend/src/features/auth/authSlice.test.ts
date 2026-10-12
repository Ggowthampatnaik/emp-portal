import { describe, expect, it } from 'vitest';

import authReducer, {
  clearAuthError,
  refreshCurrentUser,
  selectHasPermission,
  selectHasRole,
  selectIsAuthenticated,
  selectIsPrivileged,
  sessionExpired,
  setUser,
  type AuthState,
} from '@/features/auth/authSlice';
import { makeUser, managerUser, superAdminUser } from '@/test/fixtures';

const initial: AuthState = {
  user: null,
  status: 'idle',
  error: null,
  initialising: true,
};

describe('authSlice', () => {
  it('starts unauthenticated and initialising', () => {
    const state = authReducer(undefined, { type: '@@INIT' });
    expect(state.user).toBeNull();
    expect(state.initialising).toBe(true);
    expect(selectIsAuthenticated({ auth: state })).toBe(false);
  });

  it('stores the user on setUser', () => {
    const state = authReducer(initial, setUser(makeUser()));
    expect(state.status).toBe('authenticated');
    expect(selectIsAuthenticated({ auth: state })).toBe(true);
  });

  it('clears the session and explains why when the session expires', () => {
    const authed = authReducer(initial, setUser(makeUser()));
    const state = authReducer(authed, sessionExpired());
    expect(state.user).toBeNull();
    expect(state.error).toMatch(/expired/i);
    expect(state.initialising).toBe(false);
  });

  it('refreshes the user quietly, never back into the start-up loading state', () => {
    // restoreSession sets `initialising`, which shows "Restoring your session..."
    // in place of the app. A mid-session refresh must not.
    const authed = authReducer({ ...initial, initialising: false }, setUser(makeUser()));
    const pending = authReducer(authed, refreshCurrentUser.pending('req', undefined));
    expect(pending.initialising).toBe(false);

    const updated = makeUser({ profile_completed: true });
    const done = authReducer(pending, refreshCurrentUser.fulfilled(updated, 'req', undefined));
    expect(done.user).toEqual(updated);
    expect(done.initialising).toBe(false);
    expect(done.status).toBe('authenticated');
  });

  it('keeps the session when a quiet refresh fails', () => {
    const authed = authReducer({ ...initial, initialising: false }, setUser(makeUser()));
    const failed = authReducer(
      authed,
      refreshCurrentUser.rejected(new Error('offline'), 'req', undefined, 'offline'),
    );
    expect(failed.user).not.toBeNull();
    expect(failed.status).toBe('authenticated');
  });

  it('clears the error on demand', () => {
    const errored = authReducer(initial, sessionExpired());
    expect(authReducer(errored, clearAuthError()).error).toBeNull();
  });
});

describe('permission selectors', () => {
  const employeeState = { auth: authReducer(initial, setUser(makeUser())) };
  const managerState = { auth: authReducer(initial, setUser(managerUser)) };
  const superAdminState = { auth: authReducer(initial, setUser(superAdminUser)) };

  it('denies leave approval to an employee', () => {
    expect(selectHasPermission('leave.approve')(employeeState)).toBe(false);
    expect(selectHasRole('manager')(employeeState)).toBe(false);
    expect(selectIsPrivileged(employeeState)).toBe(false);
  });

  it('allows a manager to approve leave and timesheets', () => {
    expect(selectHasPermission('leave.approve')(managerState)).toBe(true);
    expect(selectHasPermission('timesheet.approve')(managerState)).toBe(true);
    expect(selectHasRole('manager')(managerState)).toBe(true);
  });

  it('requires every code when several are given', () => {
    expect(selectHasPermission('leave.approve', 'admin.manage_roles')(managerState)).toBe(
      false,
    );
  });

  it('lets a super admin through every check', () => {
    expect(selectHasPermission('admin.manage_roles')(superAdminState)).toBe(true);
    expect(selectHasRole('hr')(superAdminState)).toBe(true);
    expect(selectIsPrivileged(superAdminState)).toBe(true);
  });
});
