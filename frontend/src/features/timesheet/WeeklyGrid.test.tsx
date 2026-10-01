/**
 * The grid used to drop the task description on the way to the server, so the
 * backend's "describe every entry" rule could never be satisfied from the UI.
 * These tests pin the round trip: what is typed into the note popover is what
 * gets saved, and the submit button stays shut until every booked day has one.
 */

import { Provider } from 'react-redux';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import { addDays, mondayOf, toIsoDate } from '@/utils/date';
import type { Timesheet } from '@/types/domain';

const saveEntries = vi.fn();
const weekly = vi.fn();
const submit = vi.fn();
const myAllocations = vi.fn();

vi.mock('@/services/api/services', () => ({
  timesheetsApi: {
    weekly: (...args: unknown[]) => weekly(...args),
    saveEntries: (...args: unknown[]) => saveEntries(...args),
    submit: (...args: unknown[]) => submit(...args),
  },
  projectsApi: {
    myAllocations: (...args: unknown[]) => myAllocations(...args),
  },
}));

// Imported after the mock so the component picks up the stubbed services.
const { default: WeeklyGrid } = await import('@/features/timesheet/WeeklyGrid');

/**
 * Last week, not this one.
 *
 * The grid disables a day that has not happened yet, so in the current week the
 * number of bookable columns depends on which day the suite runs - on a Monday
 * there is exactly one, and a test that books two days fails on that day alone.
 * A week that is wholly in the past has all seven, every day of the week.
 */
const MONDAY = toIsoDate(addDays(mondayOf(new Date()), -7));

function makeSheet(overrides: Partial<Timesheet> = {}): Timesheet {
  return {
    id: 7,
    employee: 10,
    employee_code: 'TRG0005',
    employee_name: 'Asha Rao',
    department_name: 'Engineering',
    week_start_date: MONDAY,
    week_end_date: MONDAY,
    status: 'draft',
    total_hours: '0.00',
    comments: '',
    is_editable: true,
    submitted_at: null,
    decided_by_name: null,
    decided_at: null,
    decision_comment: '',
    entries: [],
    approvals: [],
    ...overrides,
  };
}

const ALLOCATION = {
  count: 1,
  results: [
    {
      project: 3,
      project_code: 'PRJ-001',
      project_name: 'Northwind Retail Platform',
    },
  ],
};

/** Renders the grid and steps it back to the week the fixtures describe. */
async function renderGrid() {
  render(
    <Provider store={createStore()}>
      <WeeklyGrid onChanged={vi.fn()} />
    </Provider>,
  );
  await userEvent.click(await screen.findByLabelText('Previous week'));
  await screen.findAllByRole('spinbutton');
}

/** The note control for the Monday cell of the only project on the grid. */
const noteButton = () => screen.getByLabelText(`Task description for PRJ-001 on ${MONDAY}`);

beforeEach(() => {
  vi.clearAllMocks();
  weekly.mockResolvedValue(makeSheet());
  myAllocations.mockResolvedValue(ALLOCATION);
  saveEntries.mockImplementation((_id: number, entries: unknown[]) =>
    Promise.resolve(makeSheet({ total_hours: '8.00', entries: entries as never })),
  );
});

describe('WeeklyGrid task descriptions', () => {
  it('sends the description with the saved entry', async () => {
    const user = userEvent.setup();
    await renderGrid();

    const monday = (await screen.findAllByRole('spinbutton'))[0]!;
    await user.type(monday, '8');

    await user.click(noteButton());
    await user.type(screen.getByLabelText('Task description'), 'Fixed the checkout retry bug');
    await user.click(screen.getByRole('button', { name: 'Done' }));

    await user.click(screen.getByRole('button', { name: /save draft/i }));

    expect(saveEntries).toHaveBeenCalledWith(7, [
      {
        project: 3,
        work_date: MONDAY,
        hours: '8.00',
        description: 'Fixed the checkout retry bug',
      },
    ]);
  });

  it('will not let a booked day be submitted without one', async () => {
    const user = userEvent.setup();
    await renderGrid();

    const monday = (await screen.findAllByRole('spinbutton'))[0]!;
    await user.type(monday, '8');

    expect(screen.getByRole('button', { name: /submit for approval/i })).toBeDisabled();
    expect(screen.getByText(/has no task description/i)).toHaveTextContent(
      `PRJ-001 on ${MONDAY}`,
    );

    await user.click(noteButton());
    await user.type(screen.getByLabelText('Task description'), 'Sprint work');
    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(screen.getByRole('button', { name: /submit for approval/i })).toBeEnabled();
    expect(screen.queryByText(/has no task description/i)).not.toBeInTheDocument();
  });

  it('loads a saved description back into the popover', async () => {
    weekly.mockResolvedValue(
      makeSheet({
        total_hours: '8.00',
        entries: [
          {
            id: 1,
            project: 3,
            project_code: 'PRJ-001',
            project_name: 'Northwind Retail Platform',
            work_date: MONDAY,
            hours: '8.00',
            description: 'Wrote the migration',
            is_billable: true,
          },
        ],
      }),
    );
    const user = userEvent.setup();
    await renderGrid();

    await user.click(await screen.findByLabelText(`Task description for PRJ-001 on ${MONDAY}`));

    expect(screen.getByLabelText('Task description')).toHaveValue('Wrote the migration');

    // The popover marks the rest of the page aria-hidden, so close it before
    // asking about the buttons underneath.
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('button', { name: /submit for approval/i })).toBeEnabled();
  });

  it('offers no note control on a day with no hours', async () => {
    await renderGrid();
    await screen.findAllByRole('spinbutton');

    expect(
      screen.queryByLabelText(`Task description for PRJ-001 on ${MONDAY}`),
    ).not.toBeInTheDocument();
  });

  it('keeps descriptions per day rather than per project', async () => {
    const user = userEvent.setup();
    await renderGrid();

    const days = await screen.findAllByRole('spinbutton');
    await user.type(days[0]!, '8');
    await user.type(days[1]!, '4');

    await user.click(noteButton());
    await user.type(screen.getByLabelText('Task description'), 'Monday work');
    await user.click(screen.getByRole('button', { name: 'Done' }));

    // Tuesday must still be asking for its own description.
    const warning = screen.getByText(/has no task description/i);
    expect(within(warning).queryByText('Monday work')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /submit for approval/i })).toBeDisabled();
  });
});
