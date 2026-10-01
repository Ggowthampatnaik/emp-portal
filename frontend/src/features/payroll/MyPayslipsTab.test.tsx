/**
 * My payslips: a Year filter offering this year and last year, and a Month
 * filter that only lets you pick a month that has a payslip.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PayslipPeriods } from '@/types/domain';

const payslipPeriods = vi.fn();
const payslip = vi.fn();

vi.mock('@/services/api/services', () => ({
  payrollApi: {
    payslipPeriods: (...args: unknown[]) => payslipPeriods(...args),
    payslip: (...args: unknown[]) => payslip(...args),
  },
}));

vi.mock('@/features/payroll/usePayslipDownload', () => ({
  usePayslipDownload: () => ({ download: vi.fn(), busy: false }),
}));

vi.mock('@/features/payroll/PayslipBreakdown', () => ({
  default: ({ slip }: { slip: { id: number } }) => <div>breakdown {slip.id}</div>,
}));

const { default: MyPayslipsTab } = await import('@/features/payroll/MyPayslipsTab');

const THIS_YEAR = new Date().getFullYear();
const LAST_YEAR = THIS_YEAR - 1;

function month(value: number, id: number) {
  const name = new Date(2000, value - 1, 1).toLocaleString('en-GB', { month: 'long' });
  return { month: value, month_name: name, payslip_id: id, net_pay: '50000.00' };
}

function periods(): PayslipPeriods {
  return {
    years: [
      { year: THIS_YEAR, months: [month(1, 11)], total_net: '50000.00' },
      { year: LAST_YEAR, months: [month(12, 22), month(11, 21)], total_net: '100000.00' },
      { year: LAST_YEAR - 1, months: [month(12, 33)], total_net: '50000.00' },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  payslipPeriods.mockResolvedValue(periods());
  payslip.mockImplementation((id: number) =>
    Promise.resolve({ id, period_label: `Slip ${id}`, run_status: 'paid' }),
  );
});

async function openSelect(label: RegExp) {
  await userEvent.click(screen.getByRole('combobox', { name: label }));
  return screen.getByRole('listbox');
}

describe('MyPayslipsTab', () => {
  it('opens on the newest payslip of this year', async () => {
    render(<MyPayslipsTab />);

    expect(await screen.findByText('breakdown 11')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /year/i })).toHaveTextContent(
      String(THIS_YEAR),
    );
    expect(screen.getByRole('combobox', { name: /month/i })).toHaveTextContent('January');
  });

  it('offers only this year and last year', async () => {
    render(<MyPayslipsTab />);
    await screen.findByText('breakdown 11');

    const options = within(await openSelect(/year/i)).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      `${THIS_YEAR} (this year)`,
      `${LAST_YEAR} (last year)`,
    ]);
  });

  it('switching year lands on that year’s newest payslip', async () => {
    render(<MyPayslipsTab />);
    await screen.findByText('breakdown 11');

    await userEvent.click(
      within(await openSelect(/year/i)).getByRole('option', { name: /last year/ }),
    );

    expect(await screen.findByText('breakdown 22')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /month/i })).toHaveTextContent('December');
  });

  it('picks a month, and months with no payslip cannot be chosen', async () => {
    render(<MyPayslipsTab />);
    await screen.findByText('breakdown 11');
    await userEvent.click(
      within(await openSelect(/year/i)).getByRole('option', { name: /last year/ }),
    );
    await screen.findByText('breakdown 22');

    const list = await openSelect(/month/i);
    expect(within(list).getAllByRole('option')).toHaveLength(12);
    expect(within(list).getByRole('option', { name: /march/i })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    await userEvent.click(within(list).getByRole('option', { name: /^november$/i }));
    await waitFor(() => expect(screen.getByText('breakdown 21')).toBeInTheDocument());
  });

  it('says so when the chosen year has no payslips', async () => {
    payslipPeriods.mockResolvedValue({
      years: [{ year: LAST_YEAR, months: [month(6, 5)], total_net: '50000.00' }],
    });
    render(<MyPayslipsTab />);

    // Nothing this year, so it opens on last year's payslip instead.
    expect(await screen.findByText('breakdown 5')).toBeInTheDocument();

    await userEvent.click(
      within(await openSelect(/year/i)).getByRole('option', { name: /this year/ }),
    );
    expect(await screen.findByText(`No payslips for ${THIS_YEAR}`)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /month/i })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});
