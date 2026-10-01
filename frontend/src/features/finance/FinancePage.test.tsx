/**
 * The Finance queue.
 *
 * Two things are worth pinning here, both about not confusing people:
 *
 * - Finance has no Reject. If a "Reject" button ever appears, the workflow has
 *   silently changed shape and a payslip can dead-end.
 * - The page must say which approval this is. There are now two on the same
 *   money — the run, and this — and an unlabelled queue is how someone releases
 *   pay thinking they are only checking arithmetic.
 */

import { Provider } from 'react-redux';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import { makeUser } from '@/test/fixtures';
import type { PayslipApproval } from '@/types/domain';

const approvals = vi.fn();
const approval = vi.fn();
const release = vi.fn();
const queryPayslip = vi.fn();

vi.mock('@/services/api/services', () => ({
  financeApi: {
    approvals: (...args: unknown[]) => approvals(...args),
    approval: (...args: unknown[]) => approval(...args),
    release: (...args: unknown[]) => release(...args),
    query: (...args: unknown[]) => queryPayslip(...args),
  },
}));

const { default: FinancePage } = await import('@/features/finance/FinancePage');

function row(overrides: Partial<PayslipApproval> = {}): PayslipApproval {
  return {
    id: 1,
    payslip: 11,
    employee_name: 'Asha Rao',
    employee_code: 'TRG0005',
    department_name: 'Engineering',
    period_label: 'July 2025',
    net_pay: '54000.00',
    status: 'processed',
    status_label: 'With Finance',
    awaits_finance: true,
    self_processed: false,
    processed_by_name: 'Priya Menon',
    processed_at: '2026-08-01T09:00:00Z',
    approved_by_name: null,
    approved_at: null,
    comment: '',
    ...overrides,
  };
}

/** Signed in as someone who may release. */
function renderPage(permissions: string[] = ['finance.view', 'finance.approve']) {
  const store = createStore({
    auth: {
      user: makeUser({ permissions: permissions as never, roles: ['finance'] as never }),
      status: 'authenticated',
      error: null,
    } as never,
  });
  render(
    <Provider store={store}>
      <FinancePage />
    </Provider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  approvals.mockResolvedValue({ count: 1, results: [row()] });
  release.mockResolvedValue(row({ status: 'approved', awaits_finance: false }));
  queryPayslip.mockResolvedValue(row({ status: 'queried', awaits_finance: false }));
});

describe('FinancePage', () => {
  it('lists what is waiting, with who sent it', async () => {
    renderPage();

    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('July 2025')).toBeInTheDocument();
    expect(within(table).getByText('Priya Menon')).toBeInTheDocument();
  });

  it('opens on what is waiting rather than everything', async () => {
    renderPage();

    await screen.findByText('Asha Rao');
    expect(approvals).toHaveBeenCalledWith(expect.objectContaining({ status: 'processed' }));
  });

  it('names both approvals, so nobody confuses them', async () => {
    renderPage();

    const notice = await screen.findByText(/approved twice over/i);
    expect(notice.textContent).toMatch(/administrator signed off the monthly run/i);
    expect(notice.textContent).toMatch(/HR sent each one here/i);
  });

  it('offers Release and Query, and never Reject', async () => {
    renderPage();

    await screen.findByText('Asha Rao');
    expect(screen.getByRole('button', { name: /release/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /query/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reject/i })).not.toBeInTheDocument();
  });

  it('says that releasing does not change the amount', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /release/i }));

    expect(screen.getByText(/the amount is not changed here/i)).toBeInTheDocument();
  });

  it('releases with an optional note', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /release/i }));
    await user.click(screen.getByRole('button', { name: 'Release' }));

    expect(release).toHaveBeenCalledWith(1, '');
  });

  it('will not raise a query without saying what it is', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /query/i }));
    const confirm = screen.getByRole('button', { name: /raise query/i });
    expect(confirm).toBeDisabled();

    // 'Query' names both the field and the dialog heading; take the field.
    await user.type(screen.getByRole('textbox'), 'The LOP days look wrong.');
    expect(confirm).toBeEnabled();

    await user.click(confirm);
    expect(queryPayslip).toHaveBeenCalledWith(1, 'The LOP days look wrong.');
  });

  it('explains that a query goes back to HR rather than ending it', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /query/i }));

    expect(screen.getByText(/goes back to Priya Menon/i)).toBeInTheDocument();
    expect(screen.getByText(/no reject/i)).toBeInTheDocument();
  });

  it('shows no controls to a read-only Finance account', async () => {
    renderPage(['finance.view']);

    await screen.findByText('Asha Rao');
    expect(screen.getByRole('button', { name: /release/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /query/i })).toBeDisabled();
  });

  it('shows who released an already-decided payslip', async () => {
    approvals.mockResolvedValue({
      count: 1,
      results: [
        row({
          status: 'approved',
          status_label: 'Released',
          awaits_finance: false,
          approved_by_name: 'Fatima Sheikh',
        }),
      ],
    });
    renderPage();

    expect(await screen.findByText('by Fatima Sheikh')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /release/i })).not.toBeInTheDocument();
  });

  it('says what an empty queue means', async () => {
    approvals.mockResolvedValue({ count: 0, results: [] });
    renderPage();

    expect(await screen.findByText(/once HR has sent them across/i)).toBeInTheDocument();
  });

  // Releasing is the independent check on a payslip its own recipient pushed
  // to Finance. HR is one person here, so this is flagged rather than blocked -
  // but it must be flagged, or the releaser has to spot the matching names.
  it('marks a payslip sent here by the employee it pays', async () => {
    approvals.mockResolvedValue({
      count: 1,
      results: [row({ self_processed: true, processed_by_name: 'Asha Rao' })],
    });
    renderPage();

    expect(await screen.findByText('Own payslip')).toBeInTheDocument();
  });

  it('leaves an ordinary payslip unmarked', async () => {
    approvals.mockResolvedValue({ count: 1, results: [row({ self_processed: false })] });
    renderPage();

    await screen.findByText('Asha Rao');
    expect(screen.queryByText('Own payslip')).not.toBeInTheDocument();
  });
});
