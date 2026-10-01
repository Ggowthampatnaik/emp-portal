/**
 * The holiday calendar's management controls.
 *
 * The page is open to everyone, but add / edit / delete and the Word-document
 * import belong to `leave.manage_policy` alone. What is pinned: the controls
 * are invisible without the permission, the edit dialog saves through PATCH
 * rather than creating a duplicate, and an import reports what it did and
 * refreshes the calendar - a silent partial import is how a holiday goes
 * missing until somebody books leave over it.
 */

import { Provider } from 'react-redux';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import HolidaysPage from '@/features/leave/HolidaysPage';
import { leaveApi } from '@/services/api/services';
import { makeUser } from '@/test/fixtures';
import type { PermissionCode } from '@/types/auth';
import type { Holiday } from '@/types/domain';

const THIS_YEAR = new Date().getFullYear();

function holiday(overrides: Partial<Holiday> = {}): Holiday {
  return {
    id: 1,
    date: `${THIS_YEAR}-01-26`,
    name: 'Republic Day',
    description: 'National holiday.',
    is_optional: false,
    day_of_week: 'Monday',
    ...overrides,
  };
}

function renderPage(permissions?: PermissionCode[], results: Holiday[] = [holiday()]) {
  vi.spyOn(leaveApi, 'holidays').mockResolvedValue({
    count: results.length,
    page: 1,
    page_size: 100,
    total_pages: 1,
    next: null,
    previous: null,
    results,
  });
  const store = createStore({
    auth: {
      user: makeUser(permissions ? { permissions } : {}),
      status: 'authenticated',
      error: null,
    } as never,
    ui: { sidebarOpen: true, colorMode: 'light', toasts: [] } as never,
  });
  return render(
    <Provider store={store}>
      <HolidaysPage />
    </Provider>,
  );
}

const MANAGE = ['leave.manage_policy'] as PermissionCode[];

/**
 * The page opens on the month grid, so anything asserting on the month cards
 * has to switch to the list first.
 */
async function showList() {
  await userEvent.setup().click(await screen.findByRole('button', { name: 'List' }));
}

describe('HolidaysPage management controls', () => {
  it('shows no management controls to a plain employee', async () => {
    renderPage();
    await showList();

    expect(await screen.findByText('Republic Day')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add holiday/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /import from word/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /edit republic day/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /remove republic day/i }),
    ).not.toBeInTheDocument();
  });

  it('gives the policy holder add, import, edit and remove', async () => {
    renderPage(MANAGE);
    await showList();

    expect(await screen.findByText('Republic Day')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add holiday/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /import from word/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /edit republic day/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove republic day/i })).toBeInTheDocument();
  });

  it('edits in place - the dialog opens prefilled and saves through PATCH', async () => {
    const update = vi
      .spyOn(leaveApi, 'updateHoliday')
      .mockResolvedValue(holiday({ name: 'Republic Day (India)' }));
    renderPage(MANAGE);
    await showList();

    await userEvent.click(await screen.findByRole('button', { name: /edit republic day/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/name/i)).toHaveValue('Republic Day');
    await userEvent.type(within(dialog).getByLabelText(/name/i), ' (India)');
    await userEvent.click(within(dialog).getByRole('button', { name: /save changes/i }));

    expect(update).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ name: 'Republic Day (India)', date: `${THIS_YEAR}-01-26` }),
    );
  });

  it('imports a Word document and reports what happened', async () => {
    const importDocx = vi.spyOn(leaveApi, 'importHolidaysDocx').mockResolvedValue({
      created: 2,
      updated: 1,
      unchanged: 0,
      skipped: [],
      skipped_count: 0,
      holidays: [
        { date: `${THIS_YEAR}-01-14`, name: 'Makar Sankranti', is_optional: false },
        { date: `${THIS_YEAR}-05-01`, name: 'Labour Day', is_optional: true },
      ],
    });
    renderPage(MANAGE);

    await userEvent.click(await screen.findByRole('button', { name: /import from word/i }));
    const dialog = await screen.findByRole('dialog');

    const file = new File(['docx bytes'], 'holidays.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    await userEvent.upload(within(dialog).getByLabelText(/choose \.docx/i), file);
    await userEvent.click(within(dialog).getByRole('button', { name: /^import$/i }));

    expect(importDocx).toHaveBeenCalledWith(file, THIS_YEAR);
    expect(await within(dialog).findByText(/2 added · 1 updated/)).toBeInTheDocument();
    // The dated result row, not the dialog's own "14 January — ..." example.
    expect(within(dialog).getByText(/14 Jan \d{4} — Makar Sankranti/)).toBeInTheDocument();
    // The calendar behind the dialog refreshes so the import is visible at once.
    expect(vi.mocked(leaveApi.holidays).mock.calls.length).toBeGreaterThan(1);
  });
});

/** Four holidays in one month, so the card has more than it shows. */
function january(count: number): Holiday[] {
  return Array.from({ length: count }, (_, index) =>
    holiday({
      id: index + 1,
      date: `${THIS_YEAR}-01-${String(index + 1).padStart(2, '0')}`,
      name: `Holiday ${index + 1}`,
    }),
  );
}

describe('HolidaysPage month cards', () => {
  it('shows two holidays and offers the rest', async () => {
    renderPage(undefined, january(4));
    await showList();

    expect(await screen.findByText('Holiday 1')).toBeInTheDocument();
    expect(screen.getByText('Holiday 2')).toBeInTheDocument();
    expect(screen.queryByText('Holiday 3')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View 2 more' })).toBeInTheDocument();
  });

  it('reveals the rest, and folds them away again', async () => {
    const user = userEvent.setup();
    renderPage(undefined, january(4));
    await user.click(await screen.findByRole('button', { name: 'List' }));

    await user.click(await screen.findByRole('button', { name: 'View 2 more' }));
    expect(screen.getByText('Holiday 3')).toBeInTheDocument();
    expect(screen.getByText('Holiday 4')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show less' }));
    expect(screen.queryByText('Holiday 3')).not.toBeInTheDocument();
  });

  it('offers nothing to expand when the month fits', async () => {
    renderPage(undefined, january(2));
    await showList();

    expect(await screen.findByText('Holiday 1')).toBeInTheDocument();
    expect(screen.getByText('Holiday 2')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /view \d+ more/i })).not.toBeInTheDocument();
  });
});

describe('HolidaysPage calendar view', () => {
  /** The calendar opens on the current month; Republic Day is in January. */
  async function openJanuary(user: ReturnType<typeof userEvent.setup>) {
    // The page already opens on the calendar; page back to January.
    await screen.findByRole('button', { name: 'Previous month' });
    for (let step = 0; step < 12; step += 1) {
      if (screen.queryByRole('heading', { name: `January ${THIS_YEAR}` })) return;
      const back = screen.getByRole('button', { name: 'Previous month' });
      if (back.hasAttribute('disabled')) return;
      await user.click(back);
    }
  }

  it('opens on the month grid, and the list is one click away', async () => {
    const user = userEvent.setup();
    renderPage();

    // One month, named, with a week header - not twelve cards.
    expect(await screen.findByRole('button', { name: 'Previous month' })).toBeInTheDocument();
    expect(screen.getByText('Mon')).toBeInTheDocument();
    expect(screen.getByText('Sun')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'List' }));
    expect(screen.getByText('Republic Day')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Calendar' }));
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeInTheDocument();
  });

  it('names the holiday inside the day it falls on', async () => {
    const user = userEvent.setup();
    renderPage();
    await openJanuary(user);

    expect(screen.getByRole('heading', { name: `January ${THIS_YEAR}` })).toBeInTheDocument();
    expect(screen.getByTitle('Republic Day')).toBeInTheDocument();
  });

  it('stops paging at the ends of the year', async () => {
    const user = userEvent.setup();
    renderPage();
    await openJanuary(user);

    expect(screen.getByRole('button', { name: 'Previous month' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next month' })).toBeEnabled();
  });

  it('lets HR open a holiday straight from the calendar', async () => {
    const user = userEvent.setup();
    renderPage(MANAGE);
    await openJanuary(user);

    await user.click(screen.getByRole('button', { name: /Republic Day/ }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByDisplayValue('Republic Day')).toBeInTheDocument();
  });

  it('leaves a holiday inert for somebody who may not edit', async () => {
    const user = userEvent.setup();
    renderPage();
    await openJanuary(user);

    // Named and readable, but not something to press.
    expect(screen.getByTitle('Republic Day')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Republic Day/ })).not.toBeInTheDocument();
  });
});
