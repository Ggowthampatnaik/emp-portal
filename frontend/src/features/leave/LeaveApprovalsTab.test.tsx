/**
 * One table serves both approval stages, so the thing worth pinning is that it
 * shows the *right* controls for each: Reject belongs to the manager stage
 * alone (decision D2), Send back belongs to HR alone, and only HR's approval is
 * described as spending the balance (decision D1). Getting that wrong would
 * tell people the wrong thing about their own entitlement.
 */

import { Provider } from 'react-redux';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import type { LeaveQueueRow } from '@/types/domain';

const pendingApprovals = vi.fn();
const hrApprovals = vi.fn();
const approve = vi.fn();
const reject = vi.fn();
const sendBack = vi.fn();

vi.mock('@/services/api/services', () => ({
  leaveApi: {
    pendingApprovals: (...args: unknown[]) => pendingApprovals(...args),
    hrApprovals: (...args: unknown[]) => hrApprovals(...args),
    approve: (...args: unknown[]) => approve(...args),
    reject: (...args: unknown[]) => reject(...args),
    sendBack: (...args: unknown[]) => sendBack(...args),
  },
}));

const { default: LeaveApprovalsTab } = await import('@/features/leave/LeaveApprovalsTab');

function row(overrides: Partial<LeaveQueueRow> = {}): LeaveQueueRow {
  return {
    id: 1,
    employee: 10,
    employee_code: 'TRG0005',
    employee_name: 'Asha Rao',
    department_name: 'Engineering',
    leave_type: 1,
    leave_type_name: 'Earned Leave',
    start_date: '2026-09-07',
    end_date: '2026-09-08',
    day_part: 'full',
    total_days: '2.0',
    reason: 'Family function.',
    contact_number: '',
    status: 'pending_manager',
    applied_at: '2026-08-24T09:00:00Z',
    decided_by_name: null,
    decided_at: null,
    decision_comment: '',
    manager_status: 'pending',
    manager_decided_by_name: null,
    manager_decided_at: null,
    manager_comment: '',
    hr_status: 'pending',
    hr_decided_by_name: null,
    hr_decided_at: null,
    hr_comment: '',
    stage: 'manager',
    approvals: [],
    cc_recipients: [],
    can_cancel: true,
    available_days: '16.0',
    entitled_days: '18.0',
    used_days: '0.0',
    ...overrides,
  };
}

const AT_HR = row({
  status: 'pending_hr',
  stage: 'hr',
  manager_status: 'approved',
  manager_decided_by_name: 'Vikram Nair',
  manager_decided_at: '2026-08-24T10:00:00Z',
  manager_comment: 'Fine by me.',
});

function renderTab(stage: 'manager' | 'hr' = 'manager') {
  render(
    <Provider store={createStore()}>
      <LeaveApprovalsTab reloadKey={0} onChanged={vi.fn()} stage={stage} />
    </Provider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  pendingApprovals.mockResolvedValue({ count: 1, results: [row()] });
  hrApprovals.mockResolvedValue({ count: 1, results: [AT_HR] });
  approve.mockResolvedValue(row({ status: 'pending_hr' }));
  reject.mockResolvedValue(row({ status: 'rejected' }));
  sendBack.mockResolvedValue(row({ status: 'pending_manager' }));
});

describe('LeaveApprovalsTab', () => {
  it('reads the manager queue for the manager stage', async () => {
    renderTab('manager');

    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
    expect(pendingApprovals).toHaveBeenCalled();
    expect(hrApprovals).not.toHaveBeenCalled();
  });

  it('reads the HR queue for the HR stage', async () => {
    renderTab('hr');

    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
    expect(hrApprovals).toHaveBeenCalled();
    expect(pendingApprovals).not.toHaveBeenCalled();
  });

  it('offers Reject to the manager and not Send back', async () => {
    renderTab('manager');
    await screen.findByText('Asha Rao');

    expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /send back/i })).not.toBeInTheDocument();
  });

  it('offers Send back to HR and not Reject', async () => {
    renderTab('hr');
    await screen.findByText('Asha Rao');

    expect(screen.getByRole('button', { name: /send back/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reject/i })).not.toBeInTheDocument();
  });

  it('names where the request goes back to', async () => {
    renderTab('hr');
    await screen.findByText('Asha Rao');

    expect(screen.getByRole('button', { name: 'Send Back To Manager' })).toBeInTheDocument();
  });

  it('shows it as a filled blue button, distinct from Approve', async () => {
    // Filled like Approve, but primary blue against Approve's green - two
    // real actions, told apart by colour rather than weight.
    renderTab('hr');
    await screen.findByText('Asha Rao');

    const sendBackControl = screen.getByRole('button', { name: 'Send Back To Manager' });
    expect(sendBackControl.className).toMatch(/MuiButton-containedPrimary/);

    expect(screen.getByRole('button', { name: /approve/i }).className).toMatch(
      /MuiButton-containedSuccess/,
    );
  });

  it('tells the manager that approving does not spend the balance', async () => {
    const user = userEvent.setup();
    renderTab('manager');
    await screen.findByText('Asha Rao');

    await user.click(screen.getByRole('button', { name: /approve/i }));

    expect(screen.getByText(/nothing is deducted yet/i)).toBeInTheDocument();
  });

  it('tells HR that approving is what deducts the balance', async () => {
    const user = userEvent.setup();
    renderTab('hr');
    await screen.findByText('Asha Rao');

    await user.click(screen.getByRole('button', { name: /approve/i }));

    expect(screen.getByText(/deducts 2.0 day\(s\) from the balance/i)).toBeInTheDocument();
  });

  it('shows the applicant’s remaining balance on every row', async () => {
    renderTab('manager');
    await screen.findByText('Asha Rao');

    expect(screen.getByText('16.0 left')).toBeInTheDocument();
  });

  it('shows HR who approved it at stage one', async () => {
    renderTab('hr');
    await screen.findByText('Asha Rao');

    const table = screen.getByRole('table');
    expect(within(table).getByText('Vikram Nair')).toBeInTheDocument();
    expect(within(table).getByText('Fine by me.')).toBeInTheDocument();
  });

  it('will not send back without a reason', async () => {
    const user = userEvent.setup();
    renderTab('hr');
    await screen.findByText('Asha Rao');

    await user.click(screen.getByRole('button', { name: /send back/i }));
    const confirm = screen.getByRole('button', { name: 'Send back' });
    expect(confirm).toBeDisabled();

    await user.type(screen.getByLabelText(/comment/i), 'Two others are off that week.');
    expect(confirm).toBeEnabled();

    await user.click(confirm);
    expect(sendBack).toHaveBeenCalledWith(1, 'Two others are off that week.');
  });

  it('lets an approval through with no comment at all', async () => {
    const user = userEvent.setup();
    renderTab('manager');
    await screen.findByText('Asha Rao');

    await user.click(screen.getByRole('button', { name: /approve/i }));
    await user.click(screen.getByRole('button', { name: 'Approve' }));

    expect(approve).toHaveBeenCalledWith(1, '');
  });

  it('says what an empty HR queue means', async () => {
    hrApprovals.mockResolvedValue({ count: 0, results: [] });
    renderTab('hr');

    expect(
      await screen.findByText(/once the reporting manager has approved them/i),
    ).toBeInTheDocument();
  });
});
