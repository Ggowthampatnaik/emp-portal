/**
 * A report row on its own page.
 *
 * The charts are drawn by recharts into a fixed-size box that measures zero in
 * jsdom, so they are not what these assertions are about. What is: the row is
 * found again from its address alone, its measures are placed against the
 * report, the fields the table has no column for are here, and a link that no
 * longer names a row says so rather than rendering an empty page.
 */

import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import ReportRowPage from '@/features/reports/ReportRowPage';
import { reportsApi } from '@/services/api/services';
import { makeUser, superAdminUser } from '@/test/fixtures';
import type { CurrentUser } from '@/types/auth';
import type { ReportRow } from '@/types/domain';

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

/** Renders the page at one address, the way the router reaches it. */
function renderAt(path: string, user: CurrentUser = superAdminUser) {
  return render(
    <Provider
      store={createStore({
        auth: { user, status: 'authenticated', error: null } as never,
      })}
    >
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/reports/:kind/:rowKey" element={<ReportRowPage />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
}

describe('ReportRowPage', () => {
  it('finds the row from its address and names it', async () => {
    vi.spyOn(reportsApi, 'leave').mockResolvedValue({
      results: [leaveRow(), leaveRow({ employee_code: 'TRG0006', employee: 'Karthik Reddy' })],
    });

    renderAt(`/reports/leave/${encodeURIComponent('TRG0005|Casual Leave')}`);

    expect(
      await screen.findByRole('heading', { name: 'Asha Rao — Casual Leave' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/TRG0005 · Engineering/)).toBeInTheDocument();
  });

  it('places each measure against the whole report', async () => {
    vi.spyOn(reportsApi, 'leave').mockResolvedValue({
      results: [
        leaveRow(),
        leaveRow({
          employee_code: 'TRG0006',
          employee: 'Karthik Reddy',
          approved_days: '12.0',
        }),
      ],
    });

    renderAt(`/reports/leave/${encodeURIComponent('TRG0005|Casual Leave')}`);

    // 4 of the 16 approved days in the report, and the smaller of the two.
    expect(await screen.findByText('25% of the report · 2nd of 2 rows')).toBeInTheDocument();
    expect(screen.getByText('Days committed')).toBeInTheDocument();
  });

  it('shows fields the report carries but the table does not', async () => {
    vi.spyOn(reportsApi, 'employees').mockResolvedValue({
      results: [
        {
          department: 'Engineering',
          headcount: 12,
          active: 11,
          on_notice: 1,
          inactive: 0,
          managers: 3,
        },
      ],
      total_headcount: 12,
    });

    renderAt('/reports/employees/Engineering');

    // `managers` is in the CSV export and in no table column. Read through
    // its own label: a bare "3" appears on an axis tick as well.
    const managers = (await screen.findByText('Managers')).parentElement!;
    expect(within(managers).getByText('3')).toBeInTheDocument();
    expect(screen.getByText('11 active of 12')).toBeInTheDocument();
  });

  it('says so when the address no longer names a row', async () => {
    vi.spyOn(reportsApi, 'leave').mockResolvedValue({ results: [leaveRow()] });

    renderAt(`/reports/leave/${encodeURIComponent('TRG9999|Sick Leave')}`);

    expect(await screen.findByText('That row is no longer in this report')).toBeInTheDocument();
  });

  it('refuses a report the caller has no permission for', async () => {
    const leave = vi.spyOn(reportsApi, 'leave');
    // A plain employee holds no reporting permission at all.
    renderAt(`/reports/leave/${encodeURIComponent('TRG0005|Casual Leave')}`, makeUser());

    expect(
      await screen.findByText('This report is not available to your role'),
    ).toBeInTheDocument();
    expect(leave).not.toHaveBeenCalled();
  });

  it('asks for the same date range the row was opened with', async () => {
    const leave = vi.spyOn(reportsApi, 'leave').mockResolvedValue({ results: [leaveRow()] });

    renderAt(
      `/reports/leave/${encodeURIComponent('TRG0005|Casual Leave')}?from=2026-01-01&to=2026-03-31`,
    );

    await screen.findByRole('heading', { name: 'Asha Rao — Casual Leave' });
    expect(leave).toHaveBeenCalledWith({ from: '2026-01-01', to: '2026-03-31' });
    // And the range is stated, so the numbers cannot be read as all-time.
    expect(screen.getByText(/1 Jan 2026 to 31 Mar 2026/)).toBeInTheDocument();
  });
});
