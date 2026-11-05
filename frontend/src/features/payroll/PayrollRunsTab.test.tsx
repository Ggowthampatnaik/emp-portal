/** Payroll runs: the whole row opens a run's payslips; the action buttons do not. */

import { Provider } from 'react-redux';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import { setUser } from '@/features/auth/authSlice';
import { makeUser } from '@/test/fixtures';
import type { PermissionCode } from '@/types/auth';
import type { PayrollRun, PayrollRunDetail } from '@/types/domain';

const runs = vi.fn();
const run = vi.fn();
const sendToFinance = vi.fn();
const createRun = vi.fn();
const processRun = vi.fn();
const timesheetCheck = vi.fn();
const pushToFinance = vi.fn();

vi.mock('@/services/api/services', () => ({
  payrollApi: {
    runs: (...args: unknown[]) => runs(...args),
    run: (...args: unknown[]) => run(...args),
    sendToFinance: (...args: unknown[]) => sendToFinance(...args),
    timesheetCheck: (...args: unknown[]) => timesheetCheck(...args),
    pushToFinance: (...args: unknown[]) => pushToFinance(...args),
    createRun: (...args: unknown[]) => createRun(...args),
    process: (...args: unknown[]) => processRun(...args),
  },
  downloadBlob: vi.fn(),
}));

const { default: PayrollRunsTab } = await import('@/features/payroll/PayrollRunsTab');

function payrollRun(overrides: Partial<PayrollRun> = {}): PayrollRun {
  return {
    id: 7,
    period_label: 'August 2026',
    status: 'processed',
    employee_count: 14,
    total_gross: '960602.00',
    total_deductions: '137284.00',
    total_net: '823318.00',
    processed_by_name: 'Priya Menon',
    sent_by_name: null,
    paid_by_name: null,
    is_editable: true,
    notes: '',
    ...overrides,
  } as unknown as PayrollRun;
}

const DETAIL = {
  ...payrollRun(),
  payslips: [
    {
      id: 1,
      employee_name: 'Asha Rao',
      employee_code: 'TRG0005',
      department_name: 'Engineering',
      paid_days: '31',
      lop_days: '0',
      gross_earnings: '70000.00',
      total_deductions: '10000.00',
      net_pay: '60000.00',
    },
  ],
} as unknown as PayrollRunDetail;

function renderTab(
  permissions: PermissionCode[] = ['payroll.process', 'payroll.push_to_finance'],
) {
  const store = createStore();
  store.dispatch(setUser(makeUser({ roles: ['employee', 'hr'], permissions })));
  render(
    <Provider store={store}>
      <PayrollRunsTab />
    </Provider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  runs.mockResolvedValue({ count: 1, next: null, previous: null, results: [payrollRun()] });
  run.mockResolvedValue(DETAIL);
  sendToFinance.mockResolvedValue(payrollRun({ status: 'with_finance' }));
  timesheetCheck.mockResolvedValue({ unapproved: [] });
});

describe('PayrollRunsTab', () => {
  it("opens a run's payslips from anywhere on its row", async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByText('August 2026'));

    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('opens it from the arrow exactly once', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('button', { name: 'Show payslips' }));

    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show payslips' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('sends the month to Finance without opening the payslips', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('button', { name: 'Send to Finance' }));
    const dialog = await screen.findByRole('dialog');
    await screen.findByText('Every timesheet for this month is approved.');
    await user.click(within(dialog).getByRole('button', { name: 'Send to Finance' }));

    await waitFor(() => expect(sendToFinance).toHaveBeenCalledWith(7));
    expect(run).not.toHaveBeenCalled();
  });

  it('warns about unapproved timesheets and still lets HR send', async () => {
    const user = userEvent.setup();
    timesheetCheck.mockResolvedValue({
      unapproved: [{ employee_code: 'TRG0005', name: 'Asha Rao', weeks: 2 }],
    });
    renderTab();

    await user.click(await screen.findByRole('button', { name: 'Send to Finance' }));
    const dialog = await screen.findByRole('dialog');

    expect(await screen.findByText('Asha Rao (TRG0005): 2 weeks')).toBeInTheDocument();
    expect(screen.getByText(/You can still send the month/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Send to Finance' })).toBeEnabled();
  });

  it('offers no approval step of its own', async () => {
    renderTab();

    await screen.findByText('August 2026');

    for (const name of ['Approve', 'Mark paid', 'Send back']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('labels a month with Finance and offers no second send', async () => {
    runs.mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [payrollRun({ status: 'with_finance', is_editable: false, is_locked: true })],
    });
    renderTab();

    expect(await screen.findByText('With Finance')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send to Finance' })).not.toBeInTheDocument();
  });

  it('shows where a payslip has got to, and only a query can be resent', async () => {
    const user = userEvent.setup();
    const locked = payrollRun({ status: 'with_finance', is_editable: false, is_locked: true });
    runs.mockResolvedValue({ count: 1, next: null, previous: null, results: [locked] });
    run.mockResolvedValue({
      ...DETAIL,
      payslips: [
        { ...DETAIL.payslips[0], finance_status: 'processed' },
        { ...DETAIL.payslips[0], id: 2, finance_status: 'queried' },
      ],
    });
    renderTab();

    await user.click(await screen.findByText('August 2026'));

    expect(await screen.findByRole('button', { name: 'With Finance' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Resend' })).toBeEnabled();
  });

  it('says why a resend failed instead of doing nothing', async () => {
    const user = userEvent.setup();
    const locked = payrollRun({ status: 'with_finance', is_editable: false, is_locked: true });
    runs.mockResolvedValue({ count: 1, next: null, previous: null, results: [locked] });
    run.mockResolvedValue({
      ...DETAIL,
      payslips: [{ ...DETAIL.payslips[0], finance_status: 'queried' }],
    });
    pushToFinance.mockRejectedValue(new Error('Refused'));
    renderTab();

    await user.click(await screen.findByText('August 2026'));
    await user.click(await screen.findByRole('button', { name: 'Resend' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('shows no Actions column to someone with nothing to do here', async () => {
    renderTab(['payroll.view_all']);

    await screen.findByText('August 2026');

    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      '',
      'Period',
      'Status',
      'Employees',
      'Gross',
      'Deductions',
      'Net',
    ]);
  });

  it('keeps the Actions column for HR', async () => {
    renderTab();

    expect(await screen.findByRole('columnheader', { name: 'Actions' })).toBeInTheDocument();
  });

  it('works out the figures as soon as a month is opened', async () => {
    const user = userEvent.setup();
    createRun.mockResolvedValue(payrollRun({ id: 9, status: 'draft' }));
    processRun.mockResolvedValue(payrollRun({ id: 9 }));
    renderTab();

    await user.click(await screen.findByRole('button', { name: 'Open a month' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Open' }),
    );

    await waitFor(() => expect(processRun).toHaveBeenCalledWith(9));
  });

  it('keeps the month and says why if the figures cannot be worked out', async () => {
    const user = userEvent.setup();
    createRun.mockResolvedValue(payrollRun({ id: 9, status: 'draft' }));
    processRun.mockRejectedValue(new Error('No employee has a salary structure'));
    renderTab();

    await user.click(await screen.findByRole('button', { name: 'Open a month' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Open' }),
    );

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await waitFor(() => expect(runs).toHaveBeenCalledTimes(2));
  });

  it('shows a dash, not zero, for a month with no figures yet', async () => {
    runs.mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [
        payrollRun({
          status: 'draft',
          employee_count: 0,
          total_gross: '0.00',
          total_deductions: '0.00',
          total_net: '0.00',
        }),
      ],
    });
    renderTab();

    await screen.findByText('August 2026');

    expect(screen.queryByText(/0\.00/)).not.toBeInTheDocument();
    expect(screen.getAllByText('-')).toHaveLength(4);
  });

  it('leaves a run with nobody in it closed', async () => {
    const user = userEvent.setup();
    runs.mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [payrollRun({ employee_count: 0, status: 'draft' })],
    });
    renderTab();

    await user.click(await screen.findByText('August 2026'));

    expect(run).not.toHaveBeenCalled();
  });
});
