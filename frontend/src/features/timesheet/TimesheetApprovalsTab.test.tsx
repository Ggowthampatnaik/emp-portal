/** Timesheet requests: the whole row opens the breakdown; the buttons do not. */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import { setUser } from '@/features/auth/authSlice';
import { makeUser } from '@/test/fixtures';

const pendingApprovals = vi.fn();
const detail = vi.fn();

vi.mock('@/services/api/services', () => ({
  timesheetsApi: {
    pendingApprovals: (...args: unknown[]) => pendingApprovals(...args),
    detail: (...args: unknown[]) => detail(...args),
    approve: vi.fn(),
    reject: vi.fn(),
    hrApproveAll: vi.fn(),
  },
}));

const { default: TimesheetApprovalsTab } =
  await import('@/features/timesheet/TimesheetApprovalsTab');

function renderTab() {
  const store = createStore();
  store.dispatch(setUser(makeUser({ permissions: ['timesheet.approve'] })));
  render(
    <Provider store={store}>
      <TimesheetApprovalsTab reloadKey={0} onChanged={vi.fn()} />
    </Provider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  pendingApprovals.mockResolvedValue({
    count: 1,
    next: null,
    previous: null,
    results: [
      {
        id: 7,
        employee_name: 'Asha Rao',
        employee_code: 'TRG0005',
        department_name: 'Engineering',
        week_start_date: '2026-11-02',
        week_end_date: '2026-11-08',
        status: 'pending',
        total_hours: '40.00',
        submitted_at: '2026-11-06T06:00:00Z',
        decision_comment: '',
      },
    ],
  });
  detail.mockResolvedValue({ id: 7, entries: [], comments: '' });
});

describe('TimesheetApprovalsTab', () => {
  it('opens the breakdown from anywhere on the row', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByText('Asha Rao'));

    expect(await screen.findByText('What was done')).toBeInTheDocument();
    expect(detail).toHaveBeenCalledTimes(1);
  });

  it('closes it again from the row', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByText('Asha Rao'));
    await screen.findByText('What was done');
    await user.click(screen.getByText('Asha Rao'));

    await waitFor(() => expect(screen.queryByText('What was done')).not.toBeInTheDocument());
  });

  it('opens it from the arrow exactly once', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('button', { name: 'Show breakdown' }));

    expect(await screen.findByText('What was done')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show breakdown' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('does not open the breakdown when approving', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('button', { name: 'Approve' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(detail).not.toHaveBeenCalled();
  });
});
