/** My requests: the whole row opens its details, and Cancel does not. */

import { Provider } from 'react-redux';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import type { LeaveRequest } from '@/types/domain';

const mine = vi.fn();
const cancel = vi.fn();

vi.mock('@/services/api/services', () => ({
  leaveApi: {
    mine: (...args: unknown[]) => mine(...args),
    cancel: (...args: unknown[]) => cancel(...args),
  },
}));

const { default: MyLeaveTab } = await import('@/features/leave/MyLeaveTab');

function request(overrides: Partial<LeaveRequest> = {}): LeaveRequest {
  return {
    id: 1,
    leave_type_name: 'Casual Leave',
    start_date: '2026-10-19',
    end_date: '2026-10-19',
    total_days: '1.0',
    status: 'pending_manager',
    stage: 'manager',
    decided_by_name: null,
    can_cancel: true,
    reason: 'Family function',
    cc_recipients: [],
    decision_comment: '',
    applied_at: '2026-10-07T09:00:00Z',
    decided_at: null,
    approvals: [],
    manager_status: 'pending',
    manager_decided_by_name: null,
    manager_decided_at: null,
    manager_comment: '',
    hr_status: 'pending',
    hr_decided_by_name: null,
    hr_decided_at: null,
    hr_comment: '',
    ...overrides,
  } as unknown as LeaveRequest;
}

function renderTab() {
  render(
    <Provider store={createStore()}>
      <MyLeaveTab reloadKey={0} onChanged={vi.fn()} />
    </Provider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mine.mockResolvedValue({ count: 1, next: null, previous: null, results: [request()] });
  cancel.mockResolvedValue(request({ status: 'cancelled', can_cancel: false }));
});

describe('MyLeaveTab', () => {
  it('opens the details when anywhere on the row is clicked, and shuts them again', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByText('1.0')); // the Days cell, nowhere near the arrow
    expect(await screen.findByText('Family function')).toBeInTheDocument();

    await user.click(screen.getByText('Casual Leave'));
    await waitFor(() => expect(screen.queryByText('Family function')).not.toBeInTheDocument());
  });

  it('opens them from the arrow exactly once, not open-and-shut', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('button', { name: 'Toggle details' }));

    expect(await screen.findByText('Family function')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toggle details' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('cancels from the Cancel button without opening the details', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(
      await screen.findByRole('button', { name: 'Cancel the Casual Leave request' }),
    );

    await waitFor(() => expect(cancel).toHaveBeenCalledWith(1, 'Cancelled by the employee.'));
    expect(screen.queryByText('Family function')).not.toBeInTheDocument();
  });
});
