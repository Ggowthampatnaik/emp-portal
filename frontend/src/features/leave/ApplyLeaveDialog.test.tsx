/**
 * The leave-type dropdown offers only what the caller can actually take.
 *
 * The server opens a balance for every type a person qualifies for, so "has a
 * balance row" is the truth about entitlement — a type with none (maternity
 * leave for a male employee) must not appear, because choosing it could only
 * end in a refusal on submit.
 */

import { Provider } from 'react-redux';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import { makeUser } from '@/test/fixtures';

const TYPES = [
  { id: 1, code: 'EL', name: 'Earned Leave' },
  { id: 2, code: 'SL', name: 'Sick Leave' },
  { id: 3, code: 'MAT', name: 'Maternity Leave' },
];

function balance(leaveType: number, code: string) {
  return {
    id: leaveType,
    leave_type: leaveType,
    leave_type_code: code,
    leave_type_name: code,
    year: new Date().getFullYear(),
    allocated_days: '10.0',
    used_days: '0.0',
    pending_days: '0.0',
    carried_forward_days: '0.0',
    available_days: '10.0',
  };
}

const myBalances = vi.fn();

vi.mock('@/services/api/services', () => ({
  leaveApi: {
    types: () => Promise.resolve({ count: 3, results: TYPES }),
    myBalances: (...args: unknown[]) => myBalances(...args),
    holidays: () => Promise.resolve({ count: 0, results: [] }),
    apply: vi.fn(),
  },
  employeesApi: {
    search: () => Promise.resolve([]),
  },
}));

const { default: ApplyLeaveDialog } = await import('@/features/leave/ApplyLeaveDialog');

function renderDialog() {
  const store = createStore({
    auth: { user: makeUser({}), status: 'authenticated', error: null } as never,
  });
  render(
    <Provider store={store}>
      <ApplyLeaveDialog open onClose={() => {}} onApplied={() => {}} />
    </Provider>,
  );
}

async function openedTypeOptions() {
  const user = userEvent.setup();
  const select = await screen.findByLabelText(/leave type/i);
  await user.click(select);
  const listbox = await screen.findByRole('listbox');
  return within(listbox)
    .queryAllByRole('option')
    .map((option) => option.textContent ?? '');
}

describe('ApplyLeaveDialog leave types', () => {
  it('hides a type the caller holds no balance for', async () => {
    // A male employee: the server opened no maternity balance.
    myBalances.mockResolvedValue([balance(1, 'EL'), balance(2, 'SL')]);

    renderDialog();
    const options = await openedTypeOptions();

    expect(options.some((text) => text.includes('Earned Leave'))).toBe(true);
    expect(options.some((text) => text.includes('Maternity Leave'))).toBe(false);
  });

  it('offers the type to somebody who holds the balance', async () => {
    myBalances.mockResolvedValue([balance(1, 'EL'), balance(2, 'SL'), balance(3, 'MAT')]);

    renderDialog();
    const options = await openedTypeOptions();

    expect(options.some((text) => text.includes('Maternity Leave'))).toBe(true);
  });
});

describe('ApplyLeaveDialog reason field', () => {
  it('carries no length hint under the box', async () => {
    myBalances.mockResolvedValue([balance(1, 'EL')]);

    renderDialog();
    await screen.findByLabelText(/leave type/i);

    expect(screen.queryByText(/at least 5 characters/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/characters/i)).not.toBeInTheDocument();
  });
});
