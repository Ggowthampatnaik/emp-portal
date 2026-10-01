/**
 * Raising a portal account from the Admin module.
 *
 * The credential is the point: whatever is typed here is what the person will
 * type at the sign-in screen, so the two fields that matter are checked before
 * anything is sent, and the email is normalised the same way sign-in normalises
 * it — otherwise "New.Person@" creates an account that "new.person@" cannot
 * open.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminUser } from '@/types/domain';

const createUser = vi.fn();

vi.mock('@/services/api/services', () => ({
  adminApi: { createUser: (...args: unknown[]) => createUser(...args) },
}));

const { default: AddUserDialog } = await import('@/features/admin/AddUserDialog');

function user(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: 42,
    email: 'new.person@trigyan.io',
    first_name: 'New',
    last_name: 'Person',
    full_name: 'New Person',
    is_active: true,
    must_change_password: true,
    roles: [],
    employee_code: null,
    department: null,
    last_login_at: null,
    created_at: '2026-08-25T00:00:00Z',
    ...overrides,
  } as AdminUser;
}

const onClose = vi.fn();
const onCreated = vi.fn();

function renderDialog() {
  render(<AddUserDialog onClose={onClose} onCreated={onCreated} />);
}

async function fill(email = 'New.Person@trigyan.io', password = 'Welcome@2026') {
  const person = userEvent.setup();
  await person.type(screen.getByLabelText(/user email id/i), email);
  await person.type(screen.getByLabelText(/temporary password/i), password);
  await person.click(screen.getByRole('button', { name: /create user/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  createUser.mockResolvedValue(user());
});

describe('AddUserDialog', () => {
  it('asks for an email and a temporary password', () => {
    renderDialog();

    expect(screen.getByLabelText(/user email id/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/temporary password/i)).toBeInTheDocument();
  });

  it('sends both to the server, with the email lower-cased', async () => {
    renderDialog();
    await fill();

    await waitFor(() => expect(createUser).toHaveBeenCalled());
    expect(createUser).toHaveBeenCalledWith({
      email: 'new.person@trigyan.io',
      temporary_password: 'Welcome@2026',
      first_name: '',
      last_name: '',
    });
  });

  it('passes the created account back so the list can take the new row', async () => {
    renderDialog();
    await fill();

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(user()));
  });

  it('will not submit without an email', async () => {
    const person = userEvent.setup();
    renderDialog();

    await person.type(screen.getByLabelText(/temporary password/i), 'Welcome@2026');
    await person.click(screen.getByRole('button', { name: /create user/i }));

    expect(createUser).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/enter the address they will sign in with/i),
    ).toBeInTheDocument();
  });

  it('will not submit a password too short to be one', async () => {
    const person = userEvent.setup();
    renderDialog();

    await person.type(screen.getByLabelText(/user email id/i), 'new@trigyan.io');
    await person.type(screen.getByLabelText(/temporary password/i), 'short');
    await person.click(screen.getByRole('button', { name: /create user/i }));

    expect(createUser).not.toHaveBeenCalled();
    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument();
  });

  it('shows the password rather than masking it', async () => {
    const person = userEvent.setup();
    renderDialog();

    const field = screen.getByLabelText(/temporary password/i);
    await person.type(field, 'Welcome@2026');

    // It has to be read out or pasted on within seconds; a masked field nobody
    // can check is how the wrong password gets sent to someone.
    expect(field).not.toHaveAttribute('type', 'password');
    expect(field).toHaveValue('Welcome@2026');
  });

  it('shows a field error from the server against its field', async () => {
    createUser.mockRejectedValue({
      code: 'invalid',
      message: 'The submitted data is invalid.',
      requestId: '-',
      fieldErrors: { email: 'An account with this email already exists.' },
      status: 400,
    });
    renderDialog();
    await fill();

    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('says what happens next', () => {
    renderDialog();

    expect(screen.getByText(/made to choose their own password/i)).toBeInTheDocument();
    expect(screen.getByText(/until you give them a role/i)).toBeInTheDocument();
  });
});
