/**
 * The dashboard's quick actions.
 *
 * "Apply for leave" is a button that starts a task, so it does the task:
 * sending somebody to the Leave page to press the same button again is a step
 * that achieves nothing. What is pinned here is that the click opens the dialog
 * in place rather than navigating, that the dialog is not mounted until it is
 * wanted - it costs three lookups on mount - and that submitting re-reads the
 * summary, since the cards behind it counted the old state.
 */

import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import { setUser } from '@/features/auth/authSlice';
import { makeUser } from '@/test/fixtures';
import type { DashboardSummary } from '@/types/domain';

const dashboard = vi.fn();
vi.mock('@/services/api/services', () => ({
  reportsApi: { dashboard: (...args: unknown[]) => dashboard(...args) },
}));

/**
 * Records every render so "was it mounted at all" can be told apart from "was
 * it mounted closed" - the difference the latch exists for.
 */
const applyDialog = vi.fn();
vi.mock('@/features/leave/ApplyLeaveDialog', () => ({
  default: (props: { open: boolean; onApplied: () => void }) => {
    applyDialog(props);
    return props.open ? (
      <div>
        Apply for leave dialog
        <button onClick={props.onApplied}>Submit request</button>
      </div>
    ) : null;
  },
}));

const SUMMARY: DashboardSummary = {
  as_of: '2026-09-07',
  horizon_days: 30,
  upcoming_birthdays: [],
  upcoming_holidays: [],
  me: {
    leave_entitled: '38.0',
    leave_used: '4.0',
    leave_pending: '0.0',
    leave_available: '34.0',
    week_hours: '0.00',
    week_status: 'draft',
    timesheet_id: null,
    open_leave_requests: 0,
    active_projects: 2,
  },
};

function renderPage() {
  const store = createStore();
  store.dispatch(setUser(makeUser()));
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/']}>
        <DashboardPage />
      </MemoryRouter>
    </Provider>,
  );
}

const { default: DashboardPage } = await import('@/features/dashboard/DashboardPage');

describe('DashboardPage quick actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dashboard.mockResolvedValue(SUMMARY);
  });

  it('opens the apply dialog in place instead of navigating', async () => {
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Apply for leave' }));

    expect(screen.getByText('Apply for leave dialog')).toBeInTheDocument();
  });

  it('does not mount the dialog until it is asked for', async () => {
    renderPage();

    await screen.findByRole('button', { name: 'Apply for leave' });
    expect(applyDialog).not.toHaveBeenCalled();
  });

  it('re-reads the summary once a request is submitted', async () => {
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Apply for leave' }));
    expect(dashboard).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Submit request' }));

    expect(dashboard).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Apply for leave dialog')).not.toBeInTheDocument();
  });

  it('leaves the other two actions as links to their pages', async () => {
    renderPage();

    expect(await screen.findByRole('link', { name: 'Fill timesheet' })).toHaveAttribute(
      'href',
      '/timesheets',
    );
    expect(screen.getByRole('link', { name: 'View payslip' })).toHaveAttribute(
      'href',
      '/payroll',
    );
  });
});
