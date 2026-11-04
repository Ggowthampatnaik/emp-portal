/** Submissions, project view: the whole row opens the team; Notify does not. */

import { Provider } from 'react-redux';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import { setUser } from '@/features/auth/authSlice';
import { makeUser } from '@/test/fixtures';
import type { ProjectSubmissionRow, SubmissionStatusRow } from '@/types/domain';

const statusByProject = vi.fn();
const statusByEmployee = vi.fn();
const notify = vi.fn();
const detail = vi.fn();

vi.mock('@/services/api/services', () => ({
  timesheetsApi: {
    statusByProject: (...args: unknown[]) => statusByProject(...args),
    statusByEmployee: (...args: unknown[]) => statusByEmployee(...args),
    notify: (...args: unknown[]) => notify(...args),
    detail: (...args: unknown[]) => detail(...args),
  },
}));

const { default: TimesheetTrackingTab } =
  await import('@/features/timesheet/TimesheetTrackingTab');

const ASHA: SubmissionStatusRow = {
  employee_id: 5,
  employee_code: 'TRG0005',
  employee_name: 'Asha Rao',
  email: 'asha.rao@trigyan.io',
  department_name: 'Engineering',
  designation_name: 'Senior Software Engineer',
  timesheet_id: null,
  status: null,
  total_hours: null,
  submitted: false,
};

function project(overrides: Partial<ProjectSubmissionRow> = {}): ProjectSubmissionRow {
  return {
    project_id: 1,
    project_code: 'PRJ-001',
    project_name: 'Northwind Retail Platform',
    client_name: 'Northwind Traders',
    project_manager_name: 'Vikram Nair',
    team_size: 1,
    submitted_count: 0,
    pending_count: 1,
    employees: [ASHA],
    ...overrides,
  };
}

function renderTab() {
  const store = createStore();
  store.dispatch(
    setUser(makeUser({ roles: ['employee', 'hr'], permissions: ['timesheet.notify'] })),
  );
  render(
    <Provider store={store}>
      <TimesheetTrackingTab reloadKey={0} />
    </Provider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  statusByProject.mockResolvedValue({
    week_start_date: '2026-09-28',
    week_end_date: '2026-10-04',
    results: [project()],
  });
  statusByEmployee.mockResolvedValue({
    week_start_date: '2026-09-28',
    week_end_date: '2026-10-04',
    submitted_count: 0,
    pending_count: 1,
    results: [ASHA],
  });
  notify.mockResolvedValue({ count: 1 });
});

describe('TimesheetTrackingTab, project view', () => {
  it("opens a project's team from anywhere on its row, and shuts it again", async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByText('Vikram Nair'));
    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();

    await user.click(screen.getByText('PRJ-001'));
    await waitFor(() => expect(screen.queryByText('Asha Rao')).not.toBeInTheDocument());
  });

  it('opens it from the arrow exactly once', async () => {
    const user = userEvent.setup();
    renderTab();

    const arrow = await screen.findByRole('button', { name: 'Show the team on PRJ-001' });
    await user.click(arrow);

    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
    expect(arrow).toHaveAttribute('aria-expanded', 'true');
  });

  it('sends reminders from Notify without opening the team', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('button', { name: /^Notify 1/ }));

    await waitFor(() => expect(notify).toHaveBeenCalled());
    expect(screen.queryByText('Asha Rao')).not.toBeInTheDocument();
  });

  it('greys out only the Notify that was pressed, and marks it Sent', async () => {
    const user = userEvent.setup();
    statusByProject.mockResolvedValue({
      week_start_date: '2026-09-28',
      week_end_date: '2026-10-04',
      results: [
        project(),
        project({
          project_id: 2,
          project_code: 'PRJ-002',
          project_manager_name: 'Meera Joshi',
          employees: [{ ...ASHA, employee_id: 6, employee_name: 'Karthik Reddy' }],
        }),
      ],
    });
    renderTab();

    const buttons = await screen.findAllByRole('button', { name: /^Notify 1/ });
    expect(buttons).toHaveLength(2);
    await user.click(buttons[0]);
    await waitFor(() => expect(notify).toHaveBeenCalledTimes(1));

    // The pressed one is done; the other project's is still there to press.
    expect(await screen.findByRole('button', { name: /^Sent/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Notify 1/ })).toBeEnabled();
  });

  it('shows Sent on load for someone the server says was already reminded', async () => {
    const reminded = { ...ASHA, reminded_at: '2026-10-12T09:00:00Z' };
    statusByProject.mockResolvedValue({
      week_start_date: '2026-09-28',
      week_end_date: '2026-10-04',
      results: [project({ employees: [reminded] })],
    });
    renderTab();

    // Nothing clicked: the reminder was sent before this page was opened.
    expect(await screen.findByRole('button', { name: /^Sent/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^Notify 1/ })).not.toBeInTheDocument();
  });

  it("opens a person's timesheet from their row in the employee view", async () => {
    const user = userEvent.setup();
    statusByEmployee.mockResolvedValue({
      week_start_date: '2026-09-28',
      week_end_date: '2026-10-04',
      submitted_count: 0,
      pending_count: 1,
      results: [{ ...ASHA, timesheet_id: 41, status: 'draft', total_hours: '8.00' }],
    });
    detail.mockResolvedValue({
      id: 41,
      status: 'draft',
      total_hours: '8.00',
      submitted_at: null,
      decided_by_name: null,
      comments: '',
      decision_comment: '',
      entries: [
        {
          id: 1,
          project: 1,
          project_code: 'PRJ-001',
          project_name: 'Northwind Retail Platform',
          work_date: '2026-09-28',
          hours: '8.00',
          description: 'Checkout API.',
          is_billable: true,
        },
      ],
    });
    renderTab();

    await user.click(await screen.findByRole('tab', { name: 'Employee based' }));
    await user.click(await screen.findByText('Asha Rao'));

    const dialog = await screen.findByRole('dialog');
    expect(detail).toHaveBeenCalledWith(41);
    expect(await within(dialog).findByText('Checkout API.')).toBeInTheDocument();
    expect(within(dialog).getByText('Draft only')).toBeInTheDocument();
  });

  it('says so when the person has no timesheet that week', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('tab', { name: 'Employee based' }));
    await user.click(await screen.findByText('Asha Rao'));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/No timesheet has been started/)).toBeInTheDocument();
    expect(detail).not.toHaveBeenCalled();
  });

  it('does not open the timesheet when Notify is pressed', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('tab', { name: 'Employee based' }));
    await user.click(await screen.findByRole('button', { name: /^Notify$/ }));

    await waitFor(() => expect(notify).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
