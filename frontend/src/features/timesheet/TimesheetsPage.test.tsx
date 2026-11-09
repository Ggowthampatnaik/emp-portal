/**
 * Which tabs each role is offered, and what the Submissions badge says.
 *
 * The badge exists so HR can see that something is outstanding without opening
 * the tab to find out — so the two things worth pinning are that it asks for
 * the *count* rather than the whole board, and that it does not ask at all for
 * somebody who cannot see the board.
 */

import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import { makeUser } from '@/test/fixtures';
import type { PermissionCode, RoleSlug } from '@/types/auth';

const pendingApprovals = vi.fn();
const submissionCounts = vi.fn();
const statusByEmployee = vi.fn();
const statusByProject = vi.fn();
const mine = vi.fn();
const weekly = vi.fn();

vi.mock('@/services/api/services', () => ({
  timesheetsApi: {
    pendingApprovals: (...args: unknown[]) => pendingApprovals(...args),
    submissionCounts: (...args: unknown[]) => submissionCounts(...args),
    statusByEmployee: (...args: unknown[]) => statusByEmployee(...args),
    statusByProject: (...args: unknown[]) => statusByProject(...args),
    mine: (...args: unknown[]) => mine(...args),
    week: () => Promise.resolve(null),
    weekly: (...args: unknown[]) => weekly(...args),
    notify: vi.fn(),
  },
  projectsApi: {
    list: () => Promise.resolve({ count: 0, results: [] }),
    myAllocations: () => Promise.resolve([]),
  },
}));

const { default: TimesheetsPage } = await import('@/features/timesheet/TimesheetsPage');

const EMPLOYEE: PermissionCode[] = ['timesheet.submit', 'timesheet.view_self'];
const MANAGER: PermissionCode[] = [...EMPLOYEE, 'timesheet.view_team', 'timesheet.approve'];
const HR: PermissionCode[] = [...MANAGER, 'timesheet.view_all'];

function renderAs(
  permissions: PermissionCode[],
  path = '/timesheets',
  roles: RoleSlug[] = ['employee'],
) {
  render(
    <Provider
      store={createStore({
        auth: {
          user: makeUser({ permissions, roles }),
          status: 'authenticated',
          error: null,
        } as never,
      })}
    >
      <MemoryRouter initialEntries={[path]}>
        <TimesheetsPage />
      </MemoryRouter>
    </Provider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  pendingApprovals.mockResolvedValue({ count: 2, results: [] });
  submissionCounts.mockResolvedValue({
    week_start_date: '2026-08-17',
    week_end_date: '2026-08-23',
    submitted_count: 9,
    pending_count: 5,
  });
  statusByEmployee.mockResolvedValue({
    week_start_date: '2026-08-17',
    week_end_date: '2026-08-23',
    results: [],
    submitted_count: 0,
    pending_count: 0,
  });
  statusByProject.mockResolvedValue({
    week_start_date: '2026-08-17',
    week_end_date: '2026-08-23',
    results: [],
  });
  mine.mockResolvedValue({ count: 0, results: [] });
  weekly.mockReturnValue(new Promise(() => {}));
});

describe('TimesheetsPage', () => {
  it('shows the outstanding count beside the Submissions tab', async () => {
    renderAs(HR);

    const tab = await screen.findByRole('tab', { name: /submissions/i });
    expect(within(tab).getByText('5')).toBeInTheDocument();
  });

  it('asks for the count, not the whole board, to fill the badge', async () => {
    renderAs(HR);

    await waitFor(() => expect(submissionCounts).toHaveBeenCalled());
    // The board itself is only fetched once the tab is actually opened.
    expect(statusByEmployee).not.toHaveBeenCalled();
  });

  it('does not ask at all for somebody who cannot see the board', async () => {
    renderAs(MANAGER);

    await screen.findByRole('tab', { name: /requests/i });
    expect(screen.queryByRole('tab', { name: /submissions/i })).not.toBeInTheDocument();
    expect(submissionCounts).not.toHaveBeenCalled();
  });

  it('refreshes the board and its badge on coming back to the page', async () => {
    const user = userEvent.setup();
    renderAs(HR);

    await user.click(await screen.findByRole('tab', { name: /submissions/i }));
    await waitFor(() => expect(submissionCounts).toHaveBeenCalled());
    const before = submissionCounts.mock.calls.length;

    fireEvent(window, new Event('focus'));

    await waitFor(() => expect(submissionCounts.mock.calls.length).toBeGreaterThan(before));
  });

  it('leaves other tabs alone on coming back to the page', async () => {
    renderAs(HR);

    await waitFor(() => expect(submissionCounts).toHaveBeenCalled());
    const before = submissionCounts.mock.calls.length;

    fireEvent(window, new Event('focus'));

    expect(submissionCounts.mock.calls.length).toBe(before);
  });

  it('shows no badge when nothing is outstanding', async () => {
    submissionCounts.mockResolvedValue({ submitted_count: 14, pending_count: 0 });
    renderAs(HR);

    const tab = await screen.findByRole('tab', { name: /submissions/i });
    expect(within(tab).queryByText('0')).not.toBeInTheDocument();
  });

  it('keeps Submissions from an Admin, who can read every sheet but chases nobody', async () => {
    renderAs([...EMPLOYEE, 'timesheet.view_all'], '/timesheets', ['employee', 'admin']);

    expect(await screen.findByRole('tab', { name: /this week/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /submissions/i })).not.toBeInTheDocument();
    // Not even the badge count is asked for.
    expect(submissionCounts).not.toHaveBeenCalled();
  });

  it('still gives Submissions to someone who is both Admin and HR', async () => {
    renderAs(HR, '/timesheets', ['employee', 'admin', 'hr']);

    expect(await screen.findByRole('tab', { name: /submissions/i })).toBeInTheDocument();
  });

  it('still gives Submissions to a Super Admin', async () => {
    renderAs([], '/timesheets', ['employee', 'super_admin']);

    expect(await screen.findByRole('tab', { name: /submissions/i })).toBeInTheDocument();
  });

  it('gives a plain employee neither queue', async () => {
    renderAs(EMPLOYEE);

    expect(await screen.findByRole('tab', { name: /this week/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /requests/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /submissions/i })).not.toBeInTheDocument();
  });
});

describe('TimesheetsPage, arriving from an approval link', () => {
  /** The dashboard card and every timesheet notification point at this path. */
  it('opens a manager on the Requests queue, not on this week', async () => {
    renderAs(MANAGER, '/timesheets/approvals');

    const tab = await screen.findByRole('tab', { name: /requests/i });
    await waitFor(() => expect(tab).toHaveAttribute('aria-selected', 'true'));
  });

  it('still opens this week at /timesheets', async () => {
    renderAs(MANAGER);

    const tab = await screen.findByRole('tab', { name: /this week/i });
    expect(tab).toHaveAttribute('aria-selected', 'true');
  });

  it('falls back to the first tab for somebody with no queue', async () => {
    renderAs(EMPLOYEE, '/timesheets/approvals');

    const tab = await screen.findByRole('tab', { name: /this week/i });
    expect(tab).toHaveAttribute('aria-selected', 'true');
  });
});

describe('TimesheetsPage, opening a past week', () => {
  it('opens a week from My timesheets in the editor', async () => {
    const user = userEvent.setup();
    mine.mockResolvedValue({
      count: 1,
      results: [
        {
          id: 9,
          week_start_date: '2026-10-12',
          week_end_date: '2026-10-18',
          total_hours: '0.00',
          status: 'draft',
          submitted_at: null,
          decided_at: null,
          decision_comment: '',
        },
      ],
    });
    renderAs(EMPLOYEE);

    await user.click(await screen.findByRole('tab', { name: /my timesheets/i }));
    await user.click(await screen.findByText(/12 Oct/));

    await waitFor(() => expect(weekly).toHaveBeenLastCalledWith('2026-10-12'));
    expect(screen.getByRole('tab', { name: /this week/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});
