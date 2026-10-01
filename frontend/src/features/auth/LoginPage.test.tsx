/**
 * Sign-in, and what "keep me signed in" actually does.
 *
 * The box is not cosmetic: it decides whether the tokens go to localStorage
 * (surviving a browser restart) or sessionStorage (dying with the tab). These
 * tests check the choice reaches storage, because a checkbox that looks right
 * and stores nothing is worse than no checkbox at all.
 */

import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import { makeUser } from '@/test/fixtures';
import { rememberedEmail, tokenStorage } from '@/services/auth/tokenStorage';

const login = vi.fn();

vi.mock('@/services/auth/authService', () => ({
  authService: {
    login: (...args: unknown[]) => login(...args),
    fetchCurrentUser: vi.fn(),
    logout: vi.fn(),
  },
}));

const { default: LoginPage } = await import('@/features/auth/LoginPage');

function renderPage() {
  render(
    <Provider store={createStore()}>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </Provider>,
  );
}

async function signIn({ remember }: { remember: boolean }) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/email/i), 'Asha.Rao@trigyan.io');
  await user.type(screen.getByLabelText(/^password/i), 'Secret@123');
  if (remember) await user.click(screen.getByRole('checkbox', { name: /keep me signed in/i }));
  await user.click(screen.getByRole('button', { name: /sign in/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  login.mockResolvedValue({ access: 'a', refresh: 'r', user: makeUser() });
});

describe('LoginPage', () => {
  it('offers the choice, unticked, when nothing is remembered', () => {
    renderPage();

    expect(screen.getByRole('checkbox', { name: /keep me signed in/i })).not.toBeChecked();
  });

  it('leaves the session in sessionStorage when the box is not ticked', async () => {
    renderPage();
    await signIn({ remember: false });

    await waitFor(() => expect(sessionStorage.getItem('empportal.access')).toBe('a'));
    expect(localStorage.getItem('empportal.access')).toBeNull();
    expect(tokenStorage.isRemembered()).toBe(false);
  });

  it('puts it in localStorage when it is', async () => {
    renderPage();
    await signIn({ remember: true });

    await waitFor(() => expect(localStorage.getItem('empportal.access')).toBe('a'));
    expect(sessionStorage.getItem('empportal.access')).toBeNull();
    expect(tokenStorage.isRemembered()).toBe(true);
  });

  it('never sends the checkbox to the API', async () => {
    renderPage();
    await signIn({ remember: true });

    await waitFor(() => expect(login).toHaveBeenCalled());
    expect(login).toHaveBeenCalledWith({
      email: 'asha.rao@trigyan.io',
      password: 'Secret@123',
    });
  });

  it('remembers the address for next time, and comes back ticked', async () => {
    renderPage();
    await signIn({ remember: true });

    await waitFor(() => expect(rememberedEmail.get()).toBe('asha.rao@trigyan.io'));

    // Re-mount as a fresh visit would, with a store that knows nothing.
    cleanup();
    renderPage();
    expect(screen.getByLabelText(/email/i)).toHaveValue('asha.rao@trigyan.io');
    expect(screen.getByRole('checkbox', { name: /keep me signed in/i })).toBeChecked();
  });

  it('forgets the address again when the box is cleared', async () => {
    rememberedEmail.set('asha.rao@trigyan.io');
    renderPage();

    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: /keep me signed in/i }));
    await user.type(screen.getByLabelText(/^password/i), 'Secret@123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(rememberedEmail.get()).toBe(''));
  });
});
