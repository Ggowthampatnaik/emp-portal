/** Submissions, project view: the whole row opens the team; Notify does not. */

import { Provider } from 'react-redux';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import { setUser } from '@/features/auth/authSlice';
import { makeUser } from '@/test/fixtures';
import type { ProjectSubmissionRow, SubmissionStatusRow } from '@/types/domain';

const statusByProject = vi.fn();
const statusByEmployee = vi.fn();
const notify = vi.fn();

vi.mock('@/services/api/services', () => ({
  timesheetsApi: {
    statusByProject: (...args: unknown[]) => statusByProject(...args),
    statusByEmployee: (...args: unknown[]) => statusByEmployee(...args),
    notify: (...args: unknown[]) => notify(...args),
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
});
