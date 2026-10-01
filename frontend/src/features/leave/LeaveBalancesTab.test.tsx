/**
 * Leave entitlement is held per calendar year.
 *
 * This page used to ask for whichever year it was today and say nothing about
 * it, so booking January's holiday in December drew on next year's allowance
 * while the screen showed this year's — the numbers were right and the page was
 * misleading, which is the worst combination.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LeaveBalance } from '@/types/domain';

const myBalances = vi.fn();

vi.mock('@/services/api/services', () => ({
  leaveApi: { myBalances: (...args: unknown[]) => myBalances(...args) },
}));

const { default: LeaveBalancesTab } = await import('@/features/leave/LeaveBalancesTab');

const THIS_YEAR = new Date().getFullYear();

function balance(overrides: Partial<LeaveBalance> = {}): LeaveBalance {
  return {
    id: 1,
    employee: 10,
    employee_name: 'Asha Rao',
    leave_type: 1,
    leave_type_code: 'EL',
    leave_type_name: 'Earned Leave',
    year: THIS_YEAR,
    allocated_days: '18.0',
    carried_forward_days: '0.0',
    entitled_days: '18.0',
    used_days: '2.0',
    pending_days: '1.0',
    available_days: '15.0',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  myBalances.mockResolvedValue([balance()]);
});

describe('LeaveBalancesTab', () => {
  it('opens on the current year', async () => {
    render(<LeaveBalancesTab reloadKey={0} />);

    expect(await screen.findByText('Earned Leave')).toBeInTheDocument();
    expect(myBalances).toHaveBeenCalledWith(THIS_YEAR);
  });

  it('lets someone look at next year', async () => {
    const user = userEvent.setup();
    render(<LeaveBalancesTab reloadKey={0} />);

    await user.click(await screen.findByLabelText('Year'));
    await user.click(await screen.findByRole('option', { name: String(THIS_YEAR + 1) }));

    expect(myBalances).toHaveBeenLastCalledWith(THIS_YEAR + 1);
  });

  it('says which year the figures belong to when it is not this one', async () => {
    const user = userEvent.setup();
    render(<LeaveBalancesTab reloadKey={0} />);

    await user.click(await screen.findByLabelText('Year'));
    await user.click(await screen.findByRole('option', { name: String(THIS_YEAR + 1) }));

    expect(
      await screen.findByText(new RegExp(`counts against ${THIS_YEAR + 1}`, 'i')),
    ).toBeInTheDocument();
  });

  it('keeps the year picker when a year has no balances at all', async () => {
    myBalances.mockResolvedValue([]);
    render(<LeaveBalancesTab reloadKey={0} />);

    expect(await screen.findByText(`No leave balances for ${THIS_YEAR}`)).toBeInTheDocument();
    expect(screen.getByLabelText('Year')).toBeInTheDocument();
  });

  it('shows the entitlement breakdown', async () => {
    render(<LeaveBalancesTab reloadKey={0} />);

    expect(await screen.findByText('15.0')).toBeInTheDocument();
    expect(screen.getByText(/of 18.0 days available/)).toBeInTheDocument();
  });
});
