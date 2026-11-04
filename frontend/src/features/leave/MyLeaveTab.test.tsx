/** My requests: the whole row opens its details, and Cancel does not. */

import { Provider } from 'react-redux';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import type { LeaveRequest } from '@/types/domain';

const mine = vi.fn();
const cancel = vi.fn();
const edit = vi.fn();

vi.mock('@/services/api/services', () => ({
  leaveApi: {
    mine: (...args: unknown[]) => mine(...args),
    cancel: (...args: unknown[]) => cancel(...args),
    edit: (...args: unknown[]) => edit(...args),
    apply: vi.fn(),
    types: () =>
      Promise.resolve({ count: 1, results: [{ id: 7, code: 'CL', name: 'Casual Leave' }] }),
    myBalances: () =>
      Promise.resolve([
        {
          id: 1,
          leave_type: 7,
          leave_type_code: 'CL',
          leave_type_name: 'Casual Leave',
          leave_type_is_paid: true,
          year: 2026,
          allocated_days: '8.0',
          carried_forward_days: '0.0',
          entitled_days: '8.0',
          used_days: '0.0',
          pending_days: '1.0',
          available_days: '7.0',
        },
      ]),
    holidays: () => Promise.resolve({ count: 0, results: [] }),
  },
  employeesApi: { search: () => Promise.resolve([]) },
}));

const { default: MyLeaveTab } = await import('@/features/leave/MyLeaveTab');

function request(overrides: Partial<LeaveRequest> = {}): LeaveRequest {
  return {
    id: 1,
    leave_type: 7,
    day_part: 'full',
    can_edit: true,
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
  edit.mockResolvedValue(request({ total_days: '2.0' }));
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

  it('keeps Cancel inside the opened request, not on the row', async () => {
    const user = userEvent.setup();
    renderTab();

    await screen.findByText('Casual Leave');
    // Closed: no Cancel anywhere on the row.
    expect(
      screen.queryByRole('button', { name: 'Cancel the Casual Leave request' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByText('Casual Leave'));
    expect(await screen.findByText('Family function')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel the Casual Leave request' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith(1, 'Cancelled by the employee.'));
  });

  it('offers no Cancel inside a request that can no longer be cancelled', async () => {
    const user = userEvent.setup();
    mine.mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [request({ can_cancel: false, status: 'approved' })],
    });
    renderTab();

    await user.click(await screen.findByText('Casual Leave'));
    expect(await screen.findByText('Family function')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Cancel the Casual Leave request' }),
    ).not.toBeInTheDocument();
  });

  it('edits a request still with the manager, from inside it', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByText('Casual Leave'));
    await user.click(
      await screen.findByRole('button', { name: 'Edit the Casual Leave request' }),
    );

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Edit leave request')).toBeInTheDocument();
    // Opens with the request's own details, and no "copy in" - that is settled.
    expect(within(dialog).getByLabelText(/^Reason/)).toHaveValue('Family function');
    expect(within(dialog).queryByLabelText(/Copy in/)).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(edit).toHaveBeenCalled());
    expect(edit.mock.calls[0][0]).toBe(1);
    expect(edit.mock.calls[0][1]).toMatchObject({ leave_type: 7, reason: 'Family function' });
  });

  it('offers no Edit once the manager has acted', async () => {
    const user = userEvent.setup();
    mine.mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [request({ status: 'pending_hr', stage: 'hr', can_edit: false })],
    });
    renderTab();

    await user.click(await screen.findByText('Casual Leave'));
    expect(await screen.findByText('Family function')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Edit the Casual Leave request' }),
    ).not.toBeInTheDocument();
  });
});
