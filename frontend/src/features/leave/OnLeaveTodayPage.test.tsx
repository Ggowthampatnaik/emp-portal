/**
 * Who is out today.
 *
 * The dashboard card counts approved leave covering today and links here, so
 * this page has to ask for exactly that - overlapping today rather than
 * starting today, and approved rather than pending - or the number and the
 * names disagree in front of an audience.
 */

import { Provider } from 'react-redux';
import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import type { LeaveRequest } from '@/types/domain';
import { todayIso } from '@/utils/date';

const list = vi.fn();
vi.mock('@/services/api/services', () => ({
  leaveApi: { list: (...args: unknown[]) => list(...args) },
}));

const { default: OnLeaveTodayPage } = await import('@/features/leave/OnLeaveTodayPage');

const TODAY = todayIso();

function leave(overrides: Partial<LeaveRequest>): LeaveRequest {
  return {
    id: 1,
    employee: 5,
    employee_code: 'TRG0005',
    employee_name: 'Asha Rao',
    department_name: 'Engineering',
    leave_type: 1,
    leave_type_name: 'Casual Leave',
    start_date: TODAY,
    end_date: TODAY,
    day_part: 'full',
    total_days: '1.0',
    reason: 'Personal work at home.',
    contact_number: '+91 98000 05005',
    status: 'approved',
    ...overrides,
  } as LeaveRequest;
}

function rows(results: LeaveRequest[]) {
  list.mockResolvedValue({ count: results.length, next: null, previous: null, results });
}

function renderPage() {
  render(
    <Provider store={createStore()}>
      <OnLeaveTodayPage />
    </Provider>,
  );
}

describe('OnLeaveTodayPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rows([]);
  });

  it('asks for approved leave that covers today', async () => {
    renderPage();

    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'approved', from: TODAY, to: TODAY }),
    );
  });

  it('says so plainly when nobody is out', async () => {
    renderPage();

    expect(await screen.findByText('Nobody is on leave today')).toBeInTheDocument();
  });

  it('lists each person with department, type, reason and contact', async () => {
    rows([leave({})]);
    renderPage();

    const row = (await screen.findByText('Asha Rao')).closest('tr');
    expect(row).not.toBeNull();
    const cell = within(row as HTMLElement);
    expect(cell.getByText('TRG0005')).toBeInTheDocument();
    expect(cell.getByText('Engineering')).toBeInTheDocument();
    expect(cell.getByText('Casual Leave')).toBeInTheDocument();
    expect(cell.getByText('Personal work at home.')).toBeInTheDocument();
    expect(cell.getByText('+91 98000 05005')).toBeInTheDocument();
  });

  it('counts the people away in the subtitle', async () => {
    rows([leave({ id: 1 }), leave({ id: 2, employee_name: 'Karthik Reddy' })]);
    renderPage();

    expect(await screen.findByText(/2 people are away/)).toBeInTheDocument();
  });

  it('reads as one person for a single absence', async () => {
    rows([leave({})]);
    renderPage();

    expect(await screen.findByText(/1 person is away/)).toBeInTheDocument();
  });

  it('sorts the roster by name', async () => {
    rows([
      leave({ id: 1, employee_name: 'Zoya Khan' }),
      leave({ id: 2, employee_name: 'Asha Rao' }),
    ]);
    renderPage();

    await screen.findByText('Asha Rao');
    const names = screen.getAllByText(/Zoya Khan|Asha Rao/).map((node) => node.textContent);
    expect(names).toEqual(['Asha Rao', 'Zoya Khan']);
  });

  it('says how long a longer absence runs for', async () => {
    rows([leave({ start_date: '2026-09-01', end_date: '2026-12-31' })]);
    renderPage();

    expect(await screen.findByText(/Until 31 Dec 2026/)).toBeInTheDocument();
  });

  it('calls out a half day', async () => {
    rows([leave({ day_part: 'first_half' })]);
    renderPage();

    expect(await screen.findByText('Half day, morning')).toBeInTheDocument();
  });
});
