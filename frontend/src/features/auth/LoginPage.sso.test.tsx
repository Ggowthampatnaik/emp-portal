/**
 * What the sign-in page offers once Microsoft SSO is configured: Microsoft
 * first, and - with password sign-in switched off - Microsoft only, except on
 * the break-glass address /login?local=1.
 */

import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';

const flags = vi.hoisted(() => ({ sso: true, password: true }));

vi.mock('@/services/auth/msalConfig', () => ({
  get isSsoConfigured() {
    return flags.sso;
  },
  get isPasswordSignInEnabled() {
    return flags.password;
  },
  loginRequest: { scopes: [] },
  apiTokenRequest: { scopes: [] },
}));

vi.mock('@azure/msal-react', () => ({
  useMsal: () => ({ instance: { loginPopup: vi.fn(), acquireTokenSilent: vi.fn() } }),
}));

vi.mock('@/services/auth/msalInstance', () => ({
  msalInstance: { clearCache: vi.fn().mockResolvedValue(undefined) },
}));

const { default: LoginPage } = await import('@/features/auth/LoginPage');

function renderPage(path = '/login') {
  render(
    <Provider store={createStore()}>
      <MemoryRouter initialEntries={[path]}>
        <LoginPage />
      </MemoryRouter>
    </Provider>,
  );
}

afterEach(() => {
  cleanup();
  flags.sso = true;
  flags.password = true;
});

describe('LoginPage with Microsoft SSO', () => {
  it('puts Microsoft first, above the password form', () => {
    renderPage();

    const microsoft = screen.getByRole('button', { name: /sign in with microsoft/i });
    const password = screen.getByLabelText(/^password/i);
    expect(
      microsoft.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('offers only Microsoft when password sign-in is off', () => {
    flags.password = false;
    renderPage();

    expect(screen.getByRole('button', { name: /sign in with microsoft/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^password/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/send me a temporary one/i)).not.toBeInTheDocument();
  });

  it('still shows the password form at /login?local=1 for break-glass accounts', () => {
    flags.password = false;
    renderPage('/login?local=1');

    expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
  });

  it('shows no Microsoft button when SSO is not configured', () => {
    flags.sso = false;
    renderPage();

    expect(
      screen.queryByRole('button', { name: /sign in with microsoft/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
  });
});
