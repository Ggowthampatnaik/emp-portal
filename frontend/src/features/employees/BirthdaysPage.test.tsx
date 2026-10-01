/**
 * The birthday calendar behind the dashboard card's "View more".
 *
 * What matters is the shape the Holidays page set: twelve month cards, always
 * all twelve, with the current month called out — a calendar, not a queue. So
 * the pins are: every month renders whether or not anyone was born in it, a
 * person appears under their own month, and the current month is the one
 * flagged. Row content is the dashboard card's row and is pinned there.
 */

import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import BirthdaysPage from '@/features/employees/BirthdaysPage';
import { makeUser } from '@/test/fixtures';
import { employeesApi, reportsApi } from '@/services/api/services';
import type { DirectoryDetail, UpcomingBirthday } from '@/types/domain';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function birthday(overrides: Partial<UpcomingBirthday> = {}): UpcomingBirthday {
  return {
    id: 1,
    employee_code: 'TRG0005',
    full_name: 'Asha Rao',
    department_name: 'Engineering',
    designation_name: 'Software Engineer',
    photo_url: null,
    day: 14,
    month: new Date().getMonth() + 1,
    celebrated_on: '2026-08-14',
    days_until: 3,
    is_today: false,
    ...overrides,
  };
}

/**
 * Rows open the directory dialog, which reads the viewer's permissions, so
 * the page needs both a store and a router. The fixture user is a plain
 * employee - the narrowest view.
 */
function renderPage() {
  const store = createStore({
    auth: { user: makeUser(), status: 'authenticated', error: null } as never,
    ui: { sidebarOpen: true, colorMode: 'light', toasts: [] } as never,
  });
  return render(
    <Provider store={store}>
      <MemoryRouter>
        <BirthdaysPage />
      </MemoryRouter>
    </Provider>,
  );
}

describe('BirthdaysPage', () => {
  it('renders all twelve months with people under their own month', async () => {
    // Somebody this month and somebody half a year away, so the assertion
    // covers a month the dashboard card's window can never reach.
    const farMonth = ((new Date().getMonth() + 6) % 12) + 1;
    vi.spyOn(reportsApi, 'birthdays').mockResolvedValue({
      count: 2,
      results: [
        birthday(),
        birthday({ id: 2, full_name: 'Rahul Iyer', month: farMonth, days_until: 180 }),
      ],
    });

    renderPage();

    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
    expect(screen.getByText('Rahul Iyer')).toBeInTheDocument();
    for (const month of MONTHS) {
      expect(screen.getByRole('heading', { name: month })).toBeInTheDocument();
    }
    expect(screen.getByText('This month')).toBeInTheDocument();
  });

  it('says so under each month nobody was born in', async () => {
    vi.spyOn(reportsApi, 'birthdays').mockResolvedValue({ count: 0, results: [] });

    renderPage();

    expect(await screen.findByText('No birthdays in January.')).toBeInTheDocument();
    expect(screen.getAllByText(/No birthdays in /)).toHaveLength(12);
  });

  // The row opens the person's directory card, which any signed-in user may
  // read - not the permission-gated /employees/:id route, which a plain
  // employee cannot open.
  it('opens a directory card when a row is clicked', async () => {
    vi.spyOn(reportsApi, 'birthdays').mockResolvedValue({ count: 1, results: [birthday()] });
    const entry = vi.spyOn(employeesApi, 'directoryEntry').mockResolvedValue({
      id: 1,
      employee_code: 'TRG0005',
      full_name: 'Asha Rao',
      email: 'asha.rao@trigyan.io',
      department_name: 'Engineering',
      designation_name: 'Software Engineer',
      reporting_manager: null,
      reporting_manager_name: null,
      direct_report_count: 0,
      date_of_joining: '2022-03-01',
      work_location: 'Hyderabad',
      photo_url: null,
      direct_reports: [],
    } satisfies DirectoryDetail);

    renderPage();

    expect(screen.queryByRole('link', { name: /Asha Rao/ })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: /Asha Rao/ }));

    expect(entry).toHaveBeenCalledWith(1);
    expect(await screen.findByText('asha.rao@trigyan.io')).toBeInTheDocument();
  });
});
