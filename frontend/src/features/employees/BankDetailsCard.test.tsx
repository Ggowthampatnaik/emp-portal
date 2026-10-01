/**
 * Decision D9 in the UI: the owner sees the whole account number, HR sees four
 * digits, and a reporting manager sees no card at all. The backend enforces the
 * same rules, but a card that renders and then 403s would still have told the
 * manager that an account exists.
 */

import { Provider } from 'react-redux';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import type { BankAccount } from '@/types/domain';

const bankAccount = vi.fn();
const saveBankAccount = vi.fn();
const deleteBankAccount = vi.fn();

vi.mock('@/services/api/services', () => ({
  employeesApi: {
    bankAccount: (...args: unknown[]) => bankAccount(...args),
    saveBankAccount: (...args: unknown[]) => saveBankAccount(...args),
    deleteBankAccount: (...args: unknown[]) => deleteBankAccount(...args),
  },
}));

const { default: BankDetailsCard } = await import('@/features/employees/BankDetailsCard');

const MASKED: BankAccount = {
  id: 1,
  employee_code: 'TRG0005',
  account_holder_name: 'Asha Rao',
  bank_name: 'HDFC Bank',
  branch_name: 'Hitech City',
  account_number_masked: 'XXXXXXXXXX7788',
  ifsc_code: 'HDFC0001234',
  account_type: 'salary',
  account_type_label: 'Salary',
  updated_by_name: 'Priya Menon',
  updated_at: '2026-08-01T10:00:00Z',
};

const FULL: BankAccount = { ...MASKED, account_number: '50100234567788' };

function renderCard(props: Partial<Parameters<typeof BankDetailsCard>[0]> = {}) {
  render(
    <Provider store={createStore()}>
      <BankDetailsCard
        employeeId={10}
        employeeName="Asha Rao"
        isOwner={false}
        canManage={false}
        {...props}
      />
    </Provider>,
  );
}

/** What the API layer throws for a record with no account yet. */
function notFound() {
  return Promise.reject({
    code: 'not_found',
    message: 'No bank account has been recorded for this employee.',
    requestId: 'req-1',
    fieldErrors: {},
    status: 404,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  bankAccount.mockResolvedValue(MASKED);
});

describe('BankDetailsCard', () => {
  it('shows the owner their full account number', async () => {
    bankAccount.mockResolvedValue(FULL);
    renderCard({ isOwner: true });

    expect(await screen.findByText('50100234567788')).toBeInTheDocument();
    expect(screen.queryByText(/only the last four digits/i)).not.toBeInTheDocument();
  });

  it('shows HR only the last four digits, and says so', async () => {
    renderCard({ canManage: true });

    expect(await screen.findByText('XXXXXXXXXX7788')).toBeInTheDocument();
    expect(screen.getByText(/only the last four digits/i)).toBeInTheDocument();
    expect(screen.queryByText('50100234567788')).not.toBeInTheDocument();
  });

  it('renders nothing at all for a reporting manager', async () => {
    renderCard({ isOwner: false, canManage: false });

    // waitFor lets the card's own load settle, so this is "never rendered",
    // not "not rendered yet".
    await waitFor(() => expect(bankAccount).not.toHaveBeenCalled());
    expect(screen.queryByText('Bank details')).not.toBeInTheDocument();
  });

  it('treats a missing account as "not recorded" rather than an error', async () => {
    bankAccount.mockImplementation(notFound);
    renderCard({ isOwner: true });

    expect(await screen.findByText(/no account recorded yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });

  it('prefills the holder name when HR adds an account from scratch', async () => {
    bankAccount.mockImplementation(notFound);
    const user = userEvent.setup();
    renderCard({ canManage: true });

    await user.click(await screen.findByRole('button', { name: 'Add' }));

    expect(screen.getByLabelText(/account holder name/i)).toHaveValue('Asha Rao');
  });

  it('leaves the number blank for HR to retype, since it is never read back', async () => {
    const user = userEvent.setup();
    renderCard({ canManage: true });

    await user.click(await screen.findByRole('button', { name: 'Edit' }));

    expect(screen.getByLabelText(/account number/i)).toHaveValue('');
    expect(screen.getByText(/type the number in full/i)).toBeInTheDocument();
  });

  it('upper-cases the IFSC as it is typed', async () => {
    const user = userEvent.setup();
    renderCard({ isOwner: true });

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const ifsc = screen.getByLabelText(/ifsc code/i);
    await user.clear(ifsc);
    await user.type(ifsc, 'icic0004321');

    expect(ifsc).toHaveValue('ICIC0004321');
  });

  it('saves the trimmed, upper-cased details', async () => {
    saveBankAccount.mockResolvedValue(FULL);
    const user = userEvent.setup();
    renderCard({ isOwner: true, canManage: false });

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const number = screen.getByLabelText(/account number/i);
    await user.clear(number);
    await user.type(number, '50100234567788');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(saveBankAccount).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        account_number: '50100234567788',
        ifsc_code: 'HDFC0001234',
        bank_name: 'HDFC Bank',
      }),
    );
  });

  it('will not save until the required fields are filled', async () => {
    const user = userEvent.setup();
    renderCard({ isOwner: true });

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    await user.clear(screen.getByLabelText(/bank name/i));

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
