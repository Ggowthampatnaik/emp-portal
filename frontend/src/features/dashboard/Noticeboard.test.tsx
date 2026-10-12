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
import type {
  DirectoryDetail,
  UpcomingAnniversary,
  UpcomingBirthday,
  UpcomingHoliday,
} from '@/types/domain';

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
    phone: '',
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
  anniversaries: UpcomingAnniversary[] = [],
) {
  const user = makeUser(permissions ? { permissions } : {});
  const store = createStore({
    auth: { user, status: 'authenticated', error: null } as never,
    ui: { sidebarOpen: true, colorMode: 'light', toasts: [] } as never,
  });

  return render(
    <Provider store={store}>
      <MemoryRouter>
        <Noticeboard birthdays={birthdays} anniversaries={anniversaries} holidays={holidays} />
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
    expect(links).toHaveLength(3);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/birthdays',
      '/holidays',
      '/anniversaries',
    ]);
  });

  it('names the window when a card is empty, rather than counting days', () => {
    renderBoard([], []);

    expect(screen.getByText('No birthdays in the next 30 days.')).toBeInTheDocument();
    expect(screen.getByText('No holidays in the next 30 days.')).toBeInTheDocument();
  });

  it('still keeps its footer when a card is empty, so the two stay level', () => {
    renderBoard([], [holiday()]);

    expect(screen.getAllByRole('link', { name: /view more/i })).toHaveLength(3);
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

  it('opens the card as a summary only, with no way through to the full record', async () => {
    vi.spyOn(employeesApi, 'directoryEntry').mockResolvedValue(directoryDetail());

    // Even for someone allowed to read every record.
    renderBoard([birthday()], [holiday()], ['employee.view_all'] as PermissionCode[]);
    await userEvent.click(screen.getByRole('button', { name: /Asha Rao/ }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /open full record/i })).not.toBeInTheDocument();
  });

  it('lists work anniversaries with the years each person completes', () => {
    renderBoard([], [], undefined, [
      anniversary({
        id: 7,
        full_name: 'Vikram Nair',
        years: 5,
        day: 17,
        month: 10,
        days_until: 10,
      }),
      anniversary({
        id: 8,
        full_name: 'Asha Rao',
        years: 1,
        day: 7,
        month: 10,
        days_until: 0,
        is_today: true,
      }),
    ]);

    const card = screen.getByText('Work anniversaries').closest('.MuiCard-root') as HTMLElement;
    expect(within(card).getByText('Years at Trigyan, this month.')).toBeInTheDocument();
    expect(within(card).getByText(/5 years · joined 17 Oct 2021/)).toBeInTheDocument();
    expect(within(card).getByText(/1 year · joined 7 Oct 2025/)).toBeInTheDocument();
    expect(within(card).getByText('🎉 Today')).toBeInTheDocument();
    expect(within(card).getByText('in 10 days')).toBeInTheDocument();
  });

  it('says so when nobody has an anniversary coming up', () => {
    renderBoard([birthday()], [holiday()]);

    expect(screen.getByText('No work anniversaries this month.')).toBeInTheDocument();
  });

  it('shows two of the month and counts the rest, with the full list behind View more', () => {
    renderBoard([], [], undefined, [
      anniversary({ id: 21, full_name: 'Rohan Desai', day: 5, days_until: -4 }),
      anniversary({ id: 22, full_name: 'Meera Joshi', day: 12, days_until: 3 }),
      anniversary({ id: 23, full_name: 'Divya Sharma', day: 23, days_until: 14 }),
      anniversary({ id: 24, full_name: 'Arjun Pillai', day: 28, days_until: 19 }),
    ]);

    const card = screen.getByText('Work anniversaries').closest('.MuiCard-root') as HTMLElement;
    expect(within(card).getByText('Rohan Desai')).toBeInTheDocument();
    expect(within(card).getByText('Meera Joshi')).toBeInTheDocument();
    expect(within(card).queryByText('Divya Sharma')).not.toBeInTheDocument();
    expect(within(card).getByText('+2 more this month')).toBeInTheDocument();
    expect(within(card).getByText('4')).toBeInTheDocument(); // the count is the month's total
    expect(within(card).getByRole('link', { name: /view more/i })).toHaveAttribute(
      'href',
      '/anniversaries',
    );
  });

  it('tops a quiet month up with the next one, counting only this month', () => {
    renderBoard([], [], undefined, [
      anniversary({ id: 31, full_name: 'Rohan Desai', day: 5, days_until: -4 }),
      anniversary({
        id: 32,
        full_name: 'Divya Sharma',
        day: 23,
        month: 11,
        days_until: 45,
        this_month: false,
      }),
    ]);

    const card = screen.getByText('Work anniversaries').closest('.MuiCard-root') as HTMLElement;
    expect(within(card).getByText('Rohan Desai')).toBeInTheDocument();
    expect(within(card).getByText('Divya Sharma')).toBeInTheDocument();
    expect(within(card).getByText('in 45 days')).toBeInTheDocument();
    expect(
      within(card).getByText('Years at Trigyan, this month and next up.'),
    ).toBeInTheDocument();
    expect(within(card).getByText('1')).toBeInTheDocument(); // only October's counts
    expect(within(card).queryByText(/more this month/)).not.toBeInTheDocument();
  });

  it('keeps anniversaries from earlier this month, saying how long ago', () => {
    renderBoard([], [], undefined, [
      anniversary({ id: 12, full_name: 'Rohan Desai', years: 6, day: 5, days_until: -4 }),
      anniversary({ id: 13, full_name: 'Meera Joshi', years: 2, day: 8, days_until: -1 }),
    ]);

    const card = screen.getByText('Work anniversaries').closest('.MuiCard-root') as HTMLElement;
    expect(within(card).getByText('Rohan Desai')).toBeInTheDocument();
    expect(within(card).getByText('4 days ago')).toBeInTheDocument();
    expect(within(card).getByText('Yesterday')).toBeInTheDocument();
  });
});

function anniversary(overrides: Partial<UpcomingAnniversary> = {}): UpcomingAnniversary {
  const years = overrides.years ?? 3;
  const month = overrides.month ?? 10;
  const day = overrides.day ?? 20;
  return {
    id: 1,
    employee_code: 'TRG0004',
    full_name: 'Vikram Nair',
    department_name: 'Engineering',
    designation_name: 'Engineering Manager',
    photo_url: null,
    date_of_joining: `${2026 - years}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    years,
    day,
    month,
    celebrated_on: `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    days_until: 13,
    is_today: false,
    this_month: true,
    ...overrides,
  };
}
