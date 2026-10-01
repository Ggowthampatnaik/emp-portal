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
import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import { makeUser } from '@/test/fixtures';
import type { PermissionCode } from '@/types/auth';

const pendingApprovals = vi.fn();
const submissionCounts = vi.fn();
const statusByEmployee = vi.fn();
const statusByProject = vi.fn();

vi.mock('@/services/api/services', () => ({
  timesheetsApi: {
    pendingApprovals: (...args: unknown[]) => pendingApprovals(...args),
    submissionCounts: (...args: unknown[]) => submissionCounts(...args),
    statusByEmployee: (...args: unknown[]) => statusByEmployee(...args),
    statusByProject: (...args: unknown[]) => statusByProject(...args),
    mine: () => Promise.resolve({ count: 0, results: [] }),
    week: () => Promise.resolve(null),
    notify: vi.fn(),
  },
  projectsApi: { list: () => Promise.resolve({ count: 0, results: [] }) },
}));

const { default: TimesheetsPage } = await import('@/features/timesheet/TimesheetsPage');

const EMPLOYEE: PermissionCode[] = ['timesheet.submit', 'timesheet.view_self'];
const MANAGER: PermissionCode[] = [...EMPLOYEE, 'timesheet.view_team', 'timesheet.approve'];
const HR: PermissionCode[] = [...MANAGER, 'timesheet.view_all'];

function renderAs(permissions: PermissionCode[], path = '/timesheets') {
  render(
    <Provider
      store={createStore({
        auth: {
          user: makeUser({ permissions }),
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
  statusByEmployee.mockResolvedValue({ results: [], submitted_count: 0, pending_count: 0 });
  statusByProject.mockResolvedValue({ results: [] });
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

  it('shows no badge when nothing is outstanding', async () => {
    submissionCounts.mockResolvedValue({ submitted_count: 14, pending_count: 0 });
    renderAs(HR);

    const tab = await screen.findByRole('tab', { name: /submissions/i });
    expect(within(tab).queryByText('0')).not.toBeInTheDocument();
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
