/**
 * The forgot-password screen.
 *
 * The server deliberately answers identically for a known and an unknown
 * address. This page is the other half of that promise: if it ever said "no
 * such account", the endpoint's silence would be pointless. That is what most
 * of these tests are checking.
 */

import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';

const forgotPassword = vi.fn();

vi.mock('@/services/auth/authService', () => ({
  authService: {
    forgotPassword: (...args: unknown[]) => forgotPassword(...args),
  },
}));

const { default: ForgotPasswordPage } = await import('@/features/auth/ForgotPasswordPage');

function renderPage() {
  render(
    <Provider store={createStore()}>
      <MemoryRouter>
        <ForgotPasswordPage />
      </MemoryRouter>
    </Provider>,
  );
}

async function submit(email: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/work email/i), email);
  await user.click(screen.getByRole('button', { name: /send temporary password/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  forgotPassword.mockResolvedValue(undefined);
});

describe('ForgotPasswordPage', () => {
  it('asks for the address and nothing else', () => {
    renderPage();

    expect(screen.getByLabelText(/work email/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it('will not submit an empty form', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /send temporary password/i })).toBeDisabled();
  });

  it('sends the trimmed address', async () => {
    renderPage();
    await submit('  asha.rao@trigyan.io  ');

    expect(forgotPassword).toHaveBeenCalledWith('asha.rao@trigyan.io');
  });

  it('never confirms that the account exists', async () => {
    renderPage();
    await submit('asha.rao@trigyan.io');

    // The address is emphasised, so the sentence spans elements; the alert is
    // the one element that holds the whole of it.
    const confirmation = await screen.findByRole('alert');
    // "If ... belongs to an active account" - conditional, deliberately.
    expect(confirmation.textContent).toMatch(/^If .* belongs to an active account/);
    expect(confirmation.textContent).toMatch(/is on its way/i);
    expect(screen.queryByText(/we found your account/i)).not.toBeInTheDocument();
  });

  it('says the same thing for an address that does not exist', async () => {
    renderPage();
    await submit('nobody@trigyan.io');

    const confirmation = await screen.findByRole('alert');
    expect(confirmation.textContent).toMatch(/is on its way/i);
    expect(screen.queryByText(/no such/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/not found/i)).not.toBeInTheDocument();
  });

  it('explains that the password expires and works once', async () => {
    renderPage();
    await submit('asha.rao@trigyan.io');

    const note = await screen.findByText(/works once/i);
    expect(note.textContent).toMatch(/30 minutes/);
  });

  it('offers a way back to sign in from both states', async () => {
    renderPage();
    expect(screen.getByRole('link', { name: /back to sign in/i })).toBeInTheDocument();

    await submit('asha.rao@trigyan.io');
    expect(await screen.findByRole('link', { name: /back to sign in/i })).toBeInTheDocument();
  });

  it('shows a failure rather than pretending it worked', async () => {
    forgotPassword.mockRejectedValue({
      code: 'server_error',
      message: 'The service is unavailable.',
      requestId: 'req-1',
      fieldErrors: {},
      status: 500,
    });
    renderPage();
    await submit('asha.rao@trigyan.io');

    expect(await screen.findByText(/service is unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/temporary password is on its way/i)).not.toBeInTheDocument();
  });
});
