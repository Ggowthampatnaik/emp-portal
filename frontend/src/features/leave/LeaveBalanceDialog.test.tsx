/**
 * Opening a balance card.
 *
 * The card gives one number. The dialog has to explain it: the sum that
 * produced it, laid out in the order it happens, and the requests that spent
 * it - otherwise "4.0 of 8.0" is something to dispute rather than read.
 */

import { Provider } from 'react-redux';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import { makeUser } from '@/test/fixtures';
import type { LeaveBalance, LeaveRequest } from '@/types/domain';

const myBalances = vi.fn();
const mine = vi.fn();

vi.mock('@/services/api/services', () => ({
  leaveApi: {
    myBalances: (...args: unknown[]) => myBalances(...args),
    mine: (...args: unknown[]) => mine(...args),
  },
}));

const { default: LeaveBalancesTab } = await import('@/features/leave/LeaveBalancesTab');

const THIS_YEAR = new Date().getFullYear();

function balance(overrides: Partial<LeaveBalance> = {}): LeaveBalance {
  return {
    id: 1,
    employee: 5,
    employee_name: 'Asha Rao',
    leave_type: 1,
    leave_type_code: 'CL',
    leave_type_name: 'Casual Leave',
    year: THIS_YEAR,
    allocated_days: '8.0',
    carried_forward_days: '0.0',
    entitled_days: '8.0',
    used_days: '4.0',
    pending_days: '0.0',
    available_days: '4.0',
    ...overrides,
  };
}

function request(overrides: Partial<LeaveRequest> = {}): LeaveRequest {
  return {
    id: 1,
    leave_type: 1,
    leave_type_name: 'Casual Leave',
    start_date: `${THIS_YEAR}-03-02`,
    end_date: `${THIS_YEAR}-03-03`,
    total_days: '2.0',
    reason: 'Family function.',
    status: 'approved',
    ...overrides,
  } as LeaveRequest;
}

function show(balances: LeaveBalance[] = [balance()], requests: LeaveRequest[] = []) {
  myBalances.mockResolvedValue(balances);
  mine.mockResolvedValue({
    count: requests.length,
    next: null,
    previous: null,
    results: requests,
  });
  render(
    <Provider
      store={createStore({
        auth: { user: makeUser({}), status: 'authenticated', error: null } as never,
      })}
    >
      <LeaveBalancesTab reloadKey={0} />
    </Provider>,
  );
}

async function openCasualLeave() {
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', { name: /Casual Leave: 4.0 days available/i }),
  );
  return screen.findByRole('dialog');
}

describe('LeaveBalanceDialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens from the balance card', async () => {
    show();
    const dialog = await openCasualLeave();

    expect(within(dialog).getByText('Casual Leave')).toBeInTheDocument();
    expect(within(dialog).getByText(`days available in ${THIS_YEAR}`)).toBeInTheDocument();
  });

  it('lays out the sum that produces the balance', async () => {
    show([
      balance({ allocated_days: '6.0', carried_forward_days: '2.0', pending_days: '1.0' }),
    ]);
    const dialog = await openCasualLeave();

    for (const line of [
      'Allocated this year',
      'Carried forward',
      'Entitled',
      'Used',
      'Pending',
      'Available',
    ]) {
      expect(within(dialog).getByText(line)).toBeInTheDocument();
    }
    expect(within(dialog).getByText('− 4.0')).toBeInTheDocument();
    expect(within(dialog).getByText('− 1.0')).toBeInTheDocument();
  });

  it('lists this year’s requests of that type', async () => {
    show([balance()], [request()]);
    const dialog = await openCasualLeave();

    await waitFor(() =>
      expect(within(dialog).getByText('Family function.')).toBeInTheDocument(),
    );
    expect(within(dialog).getByText('2.0 d')).toBeInTheDocument();
  });

  it('leaves out other types and other years', async () => {
    show(
      [balance()],
      [
        request({ id: 2, leave_type: 9, reason: 'Sick leave, different type.' }),
        request({ id: 3, start_date: `${THIS_YEAR - 1}-03-02`, reason: 'Last year.' }),
      ],
    );
    const dialog = await openCasualLeave();

    // findBy, not getBy: the empty state only appears once the fetch settles,
    // and the mock resolving is not the same as React having re-rendered.
    // findBy, not getBy: the empty state only appears once the fetch settles,
    // and the mock resolving is not the same as React having re-rendered.
    expect(
      await within(dialog).findByText(/have not requested any casual leave/i),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText('Sick leave, different type.')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Last year.')).not.toBeInTheDocument();
  });

  it('explains a type with no entitlement rather than drawing a full bar', async () => {
    show([
      balance({
        id: 3,
        leave_type: 3,
        leave_type_code: 'LOP',
        leave_type_name: 'Loss of Pay',
        allocated_days: '0.0',
        entitled_days: '0.0',
        used_days: '0.0',
        available_days: '0.0',
      }),
    ]);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: /Loss of Pay: 0.0 days available/i }),
    );

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/taken as unpaid/i)).toBeInTheDocument();
    expect(within(dialog).queryByRole('progressbar')).not.toBeInTheDocument();
  });
});
