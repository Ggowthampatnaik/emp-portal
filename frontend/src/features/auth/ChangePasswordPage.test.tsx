/**
 * Setting a password — step two of registration, and the ordinary change.
 *
 * The server retires every token for the account when the password changes,
 * this page's own included. So the one behaviour that must not regress is the
 * sign-out: leaving the user apparently signed in with a dead token means the
 * next thing they click reports a session expiry over the top of a change that
 * actually worked.
 */

import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as router from 'react-router-dom';

import { createStore } from '@/app/store';
import { makeUser } from '@/test/fixtures';
import { tokenStorage } from '@/services/auth/tokenStorage';

const changePassword = vi.fn();
const navigate = vi.fn();
let routerState: unknown = null;

vi.mock('@/services/auth/authService', () => ({
  authService: {
    changePassword: (...args: unknown[]) => changePassword(...args),
    fetchCurrentUser: vi.fn(),
    logout: vi.fn(),
  },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof router>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigate,
    useLocation: () => ({ pathname: '/change-password', state: routerState }),
  };
});

const { default: ChangePasswordPage } = await import('@/features/auth/ChangePasswordPage');

function renderPage({ mustChange = false } = {}) {
  const store = createStore({
    auth: {
      user: makeUser({ must_change_password: mustChange }),
      status: 'authenticated',
      error: null,
      initialising: false,
    } as never,
  });
  render(
    <Provider store={store}>
      <MemoryRouter>
        <ChangePasswordPage />
      </MemoryRouter>
    </Provider>,
  );
  return store;
}

beforeEach(() => {
  vi.clearAllMocks();
  routerState = null;
  changePassword.mockResolvedValue(undefined);
  tokenStorage.set({ access: 'a', refresh: 'r' });
});

describe('ChangePasswordPage', () => {
  it('asks for the current password on an ordinary visit', () => {
    renderPage();

    expect(screen.getByLabelText(/current password/i)).toBeInTheDocument();
  });

  it('calls it the temporary password when the account needs activating', () => {
    renderPage({ mustChange: true });

    expect(screen.getByLabelText(/temporary password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /set password/i })).toBeInTheDocument();
  });

  it('asks only for the new password when it arrives from registration', () => {
    routerState = { temporaryPassword: 'Temp@2026' };
    renderPage({ mustChange: true });

    expect(screen.queryByLabelText(/temporary password/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^new password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm new password/i)).toBeInTheDocument();
  });

  it('uses the carried temporary password without asking for it again', async () => {
    routerState = { temporaryPassword: 'Temp@2026' };
    const user = userEvent.setup();
    renderPage({ mustChange: true });

    await user.type(screen.getByLabelText(/^new password/i), 'Chosen@2026');
    await user.type(screen.getByLabelText(/confirm new password/i), 'Chosen@2026');
    await user.click(screen.getByRole('button', { name: /set password/i }));

    await waitFor(() =>
      expect(changePassword).toHaveBeenCalledWith('Temp@2026', 'Chosen@2026'),
    );
  });

  it('refuses to submit when the two do not match', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/current password/i), 'Old@2026');
    await user.type(screen.getByLabelText(/^new password/i), 'Chosen@2026');
    await user.type(screen.getByLabelText(/confirm new password/i), 'Chosen@2027');
    await user.click(screen.getByRole('button', { name: /change password/i }));

    expect(changePassword).not.toHaveBeenCalled();
    expect(await screen.findByText(/do not match/i)).toBeInTheDocument();
  });

  it('signs the person out and sends them back to sign in', async () => {
    const user = userEvent.setup();
    const store = renderPage();

    await user.type(screen.getByLabelText(/current password/i), 'Old@2026');
    await user.type(screen.getByLabelText(/^new password/i), 'Chosen@2026');
    await user.type(screen.getByLabelText(/confirm new password/i), 'Chosen@2026');
    await user.click(screen.getByRole('button', { name: /change password/i }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/login', { replace: true }));
    expect(store.getState().auth.user).toBeNull();
    expect(tokenStorage.get()).toBeNull();
  });

  it('keeps the session when the change was refused', async () => {
    changePassword.mockRejectedValue({
      code: 'invalid',
      message: 'Your current password is incorrect.',
      requestId: '-',
      fieldErrors: { current_password: 'Your current password is incorrect.' },
      status: 400,
    });
    const user = userEvent.setup();
    const store = renderPage();

    await user.type(screen.getByLabelText(/current password/i), 'wrong');
    await user.type(screen.getByLabelText(/^new password/i), 'Chosen@2026');
    await user.type(screen.getByLabelText(/confirm new password/i), 'Chosen@2026');
    await user.click(screen.getByRole('button', { name: /change password/i }));

    await waitFor(() => expect(changePassword).toHaveBeenCalled());
    expect(navigate).not.toHaveBeenCalled();
    expect(store.getState().auth.user).not.toBeNull();
    expect(tokenStorage.get()).not.toBeNull();
  });

  it('gives an activating user no way to skip the step', () => {
    renderPage({ mustChange: true });

    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
  });
});
