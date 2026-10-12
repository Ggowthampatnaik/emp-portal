/** Payroll runs: the whole row opens a run's payslips; the action buttons do not. */

import { Provider } from 'react-redux';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import { setUser } from '@/features/auth/authSlice';
import { makeUser } from '@/test/fixtures';
import type { PayrollRun, PayrollRunDetail } from '@/types/domain';

const runs = vi.fn();
const run = vi.fn();
const approve = vi.fn();

vi.mock('@/services/api/services', () => ({
  payrollApi: {
    runs: (...args: unknown[]) => runs(...args),
    run: (...args: unknown[]) => run(...args),
    approve: (...args: unknown[]) => approve(...args),
    createRun: vi.fn(),
    process: vi.fn(),
    reject: vi.fn(),
    markPaid: vi.fn(),
    pushToFinance: vi.fn(),
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
    approved_by_name: null,
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

function renderTab() {
  const store = createStore();
  store.dispatch(
    setUser(makeUser({ roles: ['employee', 'admin'], permissions: ['payroll.approve'] })),
  );
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
  approve.mockResolvedValue(payrollRun({ status: 'approved' }));
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

  it('approves without opening the payslips', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(approve).toHaveBeenCalled());
    expect(run).not.toHaveBeenCalled();
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
