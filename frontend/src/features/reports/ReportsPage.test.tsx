/**
 * The reports table.
 *
 * Two things are pinned here, both of them about the address: a row opens its
 * own page at a URL built from the row's own values, carrying the date range
 * that produced it, and `?tab=` opens the report it names - which is what the
 * back button from a row's page relies on.
 */

import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import ReportsPage from '@/features/reports/ReportsPage';
import { reportsApi } from '@/services/api/services';
import { superAdminUser } from '@/test/fixtures';
import type { ReportRow } from '@/types/domain';

// The charts measure their container through a ResizeObserver, which jsdom
// does not implement, and they draw nothing at zero size anyway.
vi.mock('@/components/charts/ReportCharts', () => ({
  HeadcountChart: () => null,
  LeaveChart: () => null,
  TimesheetChart: () => null,
  ProjectsChart: () => null,
}));

function leaveRow(overrides: Partial<ReportRow> = {}): ReportRow {
  return {
    employee_code: 'TRG0005',
    employee: 'Asha Rao',
    department: 'Engineering',
    leave_type: 'Casual Leave',
    approved_days: '4.0',
    pending_days: '0.0',
    rejected_requests: 1,
    ...overrides,
  };
}

/** Prints wherever the router has ended up, so a click can be asserted on. */
function Address() {
  const location = useLocation();
  return <div data-testid="address">{location.pathname + location.search}</div>;
}

function renderAt(path: string, rows: ReportRow[] = [leaveRow()]) {
  vi.spyOn(reportsApi, 'leave').mockResolvedValue({ results: rows });
  vi.spyOn(reportsApi, 'employees').mockResolvedValue({ results: [], total_headcount: 0 });
  vi.spyOn(reportsApi, 'timesheet').mockResolvedValue({ results: [] });
  vi.spyOn(reportsApi, 'projects').mockResolvedValue({ results: [] });

  return render(
    <Provider
      store={createStore({
        auth: { user: superAdminUser, status: 'authenticated', error: null } as never,
      })}
    >
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/reports/:kind/:rowKey" element={<Address />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
}

describe('ReportsPage', () => {
  it('opens the report named by ?tab', async () => {
    renderAt('/reports?tab=leave');

    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
  });

  it('opens a row on its own page, carrying the date range', async () => {
    const user = userEvent.setup();
    renderAt('/reports?tab=leave&from=2026-01-01&to=2026-03-31');

    await user.click(await screen.findByText('Asha Rao'));

    // Addressed by the row's own values, because a report row has no id -
    // percent-encoded, since those values are names typed by people.
    expect(screen.getByTestId('address')).toHaveTextContent(
      '/reports/leave/TRG0005%7CCasual%20Leave?from=2026-01-01&to=2026-03-31',
    );
  });
});
