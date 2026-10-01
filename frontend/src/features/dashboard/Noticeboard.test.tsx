/**
 * The two noticeboard cards are a matched pair.
 *
 * "Same size" is not something a test can measure in jsdom, which has no
 * layout — so what is pinned here is the thing that *causes* it: both cards go
 * through the same frame, and the grid does not start-align its cells. Those
 * two together are what made the cards different heights before, and a future
 * edit that puts `alignItems: 'start'` back would sail past a screenshot but
 * not past this.
 *
 * The rest is content: both cards say which month they are about, and both
 * offer the same way out to the full list.
 */

import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import Noticeboard from '@/features/dashboard/Noticeboard';
import { employeesApi } from '@/services/api/services';
import { makeUser } from '@/test/fixtures';
import type { PermissionCode } from '@/types/auth';
import type { DirectoryDetail, UpcomingBirthday, UpcomingHoliday } from '@/types/domain';

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

function holiday(overrides: Partial<UpcomingHoliday> = {}): UpcomingHoliday {
  return {
    id: 1,
    date: '2026-08-15',
    name: 'Independence Day',
    description: '',
    is_optional: false,
    day_of_week: 'Saturday',
    days_until: 4,
    is_today: false,
    ...overrides,
  };
}

/** The directory card the birthday rows open, in the shape the API sends. */
function directoryDetail(): DirectoryDetail {
  return {
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
  };
}

/**
 * Birthday rows open the directory dialog, which reads the viewer's
 * permissions to decide whether to offer the full record - so the board needs
 * a store. `permissions` defaults to a plain employee's, the narrow case.
 */
function renderBoard(
  birthdays: UpcomingBirthday[],
  holidays: UpcomingHoliday[],
  permissions?: PermissionCode[],
) {
  const user = makeUser(permissions ? { permissions } : {});
  const store = createStore({
    auth: { user, status: 'authenticated', error: null } as never,
    ui: { sidebarOpen: true, colorMode: 'light', toasts: [] } as never,
  });

  return render(
    <Provider store={store}>
      <MemoryRouter>
        <Noticeboard birthdays={birthdays} holidays={holidays} />
      </MemoryRouter>
    </Provider>,
  );
}

describe('Noticeboard', () => {
  it('names the window on both cards', () => {
    renderBoard([birthday()], [holiday()]);

    // Headings name the rolling window, not the calendar month. Month-scoped
    // headings forced month-scoped data, which emptied both cards on the 30th
    // and 31st of every month.
    expect(screen.getByText('Upcoming birthdays')).toBeInTheDocument();
    expect(screen.getByText('Upcoming holidays')).toBeInTheDocument();
    expect(screen.getAllByText('Company-wide, over the next 30 days.')).toHaveLength(2);
  });

  it('builds both cards from the same frame', () => {
    const { container } = renderBoard([birthday()], [holiday()]);
    const [first, second] = Array.from(container.querySelectorAll('.MuiCard-root'));

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    // The property that makes a row of cards one height: each fills its cell.
    for (const card of [first, second]) {
      expect(getComputedStyle(card).height).toBe('100%');
      expect(getComputedStyle(card).flexDirection).toBe('column');
    }
  });

  it('does not start-align the grid, which would size each cell to its content', () => {
    const { container } = renderBoard([birthday()], [holiday()]);
    const grid = container.firstElementChild as HTMLElement;

    expect(getComputedStyle(grid).display).toBe('grid');
    expect(getComputedStyle(grid).alignItems).not.toBe('start');
  });

  it('gives both cards the same way through to the full list', () => {
    renderBoard([birthday()], [holiday()]);

    const links = screen.getAllByRole('link', { name: /view more/i });
    expect(links).toHaveLength(2);
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/birthdays', '/holidays']);
  });

  it('names the window when a card is empty, rather than counting days', () => {
    renderBoard([], []);

    expect(screen.getByText('No birthdays in the next 30 days.')).toBeInTheDocument();
    expect(screen.getByText('No holidays in the next 30 days.')).toBeInTheDocument();
  });

  it('still keeps its footer when a card is empty, so the two stay level', () => {
    renderBoard([], [holiday()]);

    expect(screen.getAllByRole('link', { name: /view more/i })).toHaveLength(2);
  });

  it('shows what is in each list', () => {
    const { container } = renderBoard([birthday()], [holiday()]);
    const [birthdayCard, holidayCard] = Array.from(container.querySelectorAll('.MuiCard-root'));

    expect(within(birthdayCard as HTMLElement).getByText('Asha Rao')).toBeInTheDocument();
    expect(
      within(holidayCard as HTMLElement).getByText('Independence Day'),
    ).toBeInTheDocument();
  });

  // A birthday row opens the person's *directory card*, which every signed-in
  // user may read - not the /employees/:id route, which requires
  // employee.view_team or view_all and would send a plain employee - most of
  // the company - to /forbidden straight off their own dashboard.
  it('opens a directory card from a birthday row, for any viewer', async () => {
    const entry = vi.spyOn(employeesApi, 'directoryEntry').mockResolvedValue(directoryDetail());

    renderBoard([birthday()], [holiday()]);

    expect(screen.queryByRole('link', { name: /Asha Rao/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Asha Rao/ }));

    expect(entry).toHaveBeenCalledWith(1);
    expect(await screen.findByText('asha.rao@trigyan.io')).toBeInTheDocument();
    // The card shows work details; the way into the full record is not
    // offered to a viewer whose role may not open it.
    expect(screen.queryByRole('button', { name: /open full record/i })).not.toBeInTheDocument();
  });

  it('offers the full record inside the card only to a viewer who may open it', async () => {
    vi.spyOn(employeesApi, 'directoryEntry').mockResolvedValue(directoryDetail());

    renderBoard([birthday()], [holiday()], ['employee.view_all'] as PermissionCode[]);
    await userEvent.click(screen.getByRole('button', { name: /Asha Rao/ }));

    expect(
      await screen.findByRole('button', { name: /open full record/i }),
    ).toBeInTheDocument();
  });
});
