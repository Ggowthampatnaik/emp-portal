/**
 * Add employee: the temporary password is held to the portal's password rule,
 * and the phone number to the same per-country rules as everywhere else.
 */

import { Provider } from 'react-redux';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';

const create = vi.fn();

vi.mock('@/services/api/services', () => ({
  employeesApi: {
    create: (...args: unknown[]) => create(...args),
    departments: () => Promise.resolve({ count: 0, results: [] }),
    designations: () => Promise.resolve({ count: 0, results: [] }),
    list: () => Promise.resolve({ count: 0, results: [] }),
  },
}));

const { default: EmployeeFormDialog } = await import('@/features/employees/EmployeeFormDialog');

function renderForm() {
  render(
    <Provider store={createStore()}>
      <EmployeeFormDialog open onClose={vi.fn()} onSaved={vi.fn()} />
    </Provider>,
  );
}

const passwordField = () => screen.getByLabelText(/^Temporary password/);

async function fillTheRest(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^Employee ID/), 'TRG0099');
  await user.type(screen.getByLabelText(/^Work email/), 'new.joiner@trigyan.io');
  await user.type(screen.getByLabelText(/^First name/), 'New');
  await user.type(screen.getByLabelText(/^Last name/), 'Joiner');
}

beforeEach(() => {
  vi.clearAllMocks();
  create.mockResolvedValue({ id: 99, full_name: 'New Joiner' });
});

const phoneField = () => screen.getByLabelText(/^Phone/);

describe('EmployeeFormDialog, phone number', () => {
  async function fillAll(user: ReturnType<typeof userEvent.setup>) {
    await fillTheRest(user);
    await user.type(passwordField(), 'Welcome@2026');
  }

  it('starts on India, with the country code in its own box', () => {
    renderForm();

    expect(screen.getByRole('combobox', { name: /country code/i })).toHaveValue('+91');
  });

  it('takes nothing but digits, spaces and dashes', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(phoneField(), 'fhgfhg98765-43210xyz');

    expect(phoneField()).toHaveValue('98765-43210');
  });

  it('will not create the employee with an invalid number', async () => {
    const user = userEvent.setup();
    renderForm();
    await fillAll(user);
    await user.type(phoneField(), '12345');

    await user.click(screen.getByRole('button', { name: 'Create employee' }));

    expect(create).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        'Enter a valid 10-digit Indian mobile number, starting with 6, 7, 8 or 9.',
      ),
    ).toBeInTheDocument();
  });

  it('sends a valid number with its country code', async () => {
    const user = userEvent.setup();
    renderForm();
    await fillAll(user);
    await user.type(phoneField(), '98765 43210');

    await user.click(screen.getByRole('button', { name: 'Create employee' }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).toMatchObject({ phone: '+919876543210' });
  });

  it('checks the number against the country that was picked', async () => {
    const user = userEvent.setup();
    renderForm();
    await fillAll(user);

    await user.click(screen.getByRole('combobox', { name: /country code/i }));
    await user.keyboard('United Kingdom{Enter}');
    await user.type(phoneField(), '7400 123456');
    await user.click(screen.getByRole('button', { name: 'Create employee' }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).toMatchObject({ phone: '+447400123456' });
  });

  it('leaves the phone out when none is given', async () => {
    const user = userEvent.setup();
    renderForm();
    await fillAll(user);

    await user.click(screen.getByRole('button', { name: 'Create employee' }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).not.toHaveProperty('phone');
  });
});

describe('EmployeeFormDialog, temporary password', () => {
  it('states the rule before anything is typed', () => {
    renderForm();

    expect(
      screen.getByText(/At least 8 characters, with an uppercase letter/),
    ).toBeInTheDocument();
    expect(passwordField()).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('says what is still missing as it is typed', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(passwordField(), 'welcome');

    expect(passwordField()).toHaveAttribute('aria-invalid', 'true');
    expect(
      screen.getByText(
        'Add at least 8 characters, an uppercase letter, a number and a special character (@ # $ % & !).',
      ),
    ).toBeInTheDocument();
  });

  it('will not create the employee with a weak password', async () => {
    const user = userEvent.setup();
    renderForm();
    await fillTheRest(user);
    await user.type(passwordField(), 'Welcome2026');

    await user.click(screen.getByRole('button', { name: 'Create employee' }));

    expect(create).not.toHaveBeenCalled();
    expect(screen.getByText('Add a special character (@ # $ % & !).')).toBeInTheDocument();
  });

  it('flags an empty password when Create is pressed', async () => {
    const user = userEvent.setup();
    renderForm();
    await fillTheRest(user);

    await user.click(screen.getByRole('button', { name: 'Create employee' }));

    expect(create).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a temporary password.')).toBeInTheDocument();
  });

  it('creates the employee once the password meets the rule', async () => {
    const user = userEvent.setup();
    renderForm();
    await fillTheRest(user);
    await user.type(passwordField(), 'Welcome@2026');

    expect(passwordField()).not.toHaveAttribute('aria-invalid', 'true');
    await user.click(screen.getByRole('button', { name: 'Create employee' }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).toMatchObject({ temporary_password: 'Welcome@2026' });
  });
});
