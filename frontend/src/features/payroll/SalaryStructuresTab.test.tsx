/**
 * Salary structures: finding one, and picking who a new one is for.
 *
 * Both were the same problem in different clothes — a list with no search and a
 * form with a hundred-row dropdown. So both are tested the same way: the typing
 * reaches the *server*, because a filter that only sifts the page already
 * loaded is a filter that lies once there are more than a page of people.
 */

import { Provider } from 'react-redux';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import type { EmployeeListItem, SalaryStructure } from '@/types/domain';

const structures = vi.fn();
const createStructure = vi.fn();
const employeeList = vi.fn();

vi.mock('@/services/api/services', () => ({
  payrollApi: {
    structures: (...args: unknown[]) => structures(...args),
    createStructure: (...args: unknown[]) => createStructure(...args),
  },
  employeesApi: { list: (...args: unknown[]) => employeeList(...args) },
}));

const { default: SalaryStructuresTab } = await import('@/features/payroll/SalaryStructuresTab');

function structure(overrides: Partial<SalaryStructure> = {}): SalaryStructure {
  return {
    id: 1,
    employee: 5,
    employee_name: 'Asha Rao',
    employee_code: 'TRG0005',
    department_name: 'Engineering',
    effective_from: '2024-01-01',
    effective_to: null,
    basic: '40000.00',
    hra: '20000.00',
    conveyance_allowance: '2000.00',
    medical_allowance: '2000.00',
    special_allowance: '6000.00',
    provident_fund: '4800.00',
    professional_tax: '200.00',
    income_tax: '5000.00',
    other_deductions: '0.00',
    gross_monthly: '70000.00',
    deductions_monthly: '10000.00',
    net_monthly: '60000.00',
    annual_ctc: '840000.00',
    is_current: true,
    notes: '',
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function employee(overrides: Partial<EmployeeListItem> = {}): EmployeeListItem {
  return {
    id: 6,
    employee_code: 'TRG0006',
    full_name: 'Karthik Reddy',
    email: 'karthik.reddy@trigyan.io',
    photo_url: null,
    department: 1,
    department_name: 'Engineering',
    designation: 1,
    designation_name: 'Software Engineer',
    reporting_manager: 4,
    reporting_manager_name: 'Vikram Nair',
    date_of_joining: '2022-01-03',
    employment_status: 'active',
    user_id: 105,
    roles: ['employee'],
    work_location: 'Hyderabad',
    phone: '9876500011',
    asset_count: 0,
    ...overrides,
  };
}

function renderTab() {
  render(
    <Provider store={createStore()}>
      <SalaryStructuresTab />
    </Provider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  structures.mockResolvedValue({ count: 1, results: [structure()] });
  employeeList.mockResolvedValue({ count: 1, results: [employee()] });
  createStructure.mockResolvedValue(structure({ id: 2, employee_name: 'Karthik Reddy' }));
});

describe('SalaryStructuresTab — finding a structure', () => {
  it('offers a search box', async () => {
    renderTab();

    expect(await screen.findByLabelText(/search/i)).toBeInTheDocument();
  });

  it('asks the server rather than sifting the page it already has', async () => {
    const user = userEvent.setup();
    renderTab();

    await screen.findByText('Asha Rao');
    await user.type(screen.getByLabelText(/search/i), 'Reddy');

    await waitFor(() =>
      expect(structures).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'Reddy' })),
    );
  });

  it('goes back to the first page when the term changes', async () => {
    const user = userEvent.setup();
    renderTab();

    await screen.findByText('Asha Rao');
    await user.type(screen.getByLabelText(/search/i), 'Reddy');

    await waitFor(() =>
      expect(structures).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 })),
    );
  });

  it('keeps the current/superseded filter alongside the search', async () => {
    const user = userEvent.setup();
    renderTab();

    await screen.findByText('Asha Rao');
    await user.type(screen.getByLabelText(/search/i), 'Reddy');

    await waitFor(() =>
      expect(structures).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: 'Reddy', current: 'true' }),
      ),
    );
  });

  it('does not search on every keystroke', async () => {
    const user = userEvent.setup();
    renderTab();

    await screen.findByText('Asha Rao');
    const before = structures.mock.calls.length;
    await user.type(screen.getByLabelText(/search/i), 'Reddy');

    await waitFor(() => expect(structures.mock.calls.length).toBeGreaterThan(before));
    expect(structures.mock.calls.length - before).toBeLessThan(5);
  });
});

describe('SalaryStructuresTab — choosing the employee', () => {
  it('is a type-ahead, not a dropdown of everybody', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('button', { name: /new structure/i }));

    const field = screen.getByLabelText(/employee/i);
    expect(field).toHaveAttribute('placeholder', 'Type a name, code or email');
  });

  it('narrows on what was typed, at the server', async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByRole('button', { name: /new structure/i }));

    await user.type(screen.getByLabelText(/employee/i), 'Kart');

    await waitFor(() =>
      expect(employeeList).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: 'Kart', employment_status: 'active' }),
      ),
    );
  });

  it('shows the matches with enough to tell two people apart', async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByRole('button', { name: /new structure/i }));

    await user.type(screen.getByLabelText(/employee/i), 'Kart');

    const option = await screen.findByRole('option');
    expect(within(option).getByText('Karthik Reddy')).toBeInTheDocument();
    expect(
      within(option).getByText(/TRG0006 · Software Engineer · Engineering/),
    ).toBeInTheDocument();
  });

  it('selects the employee that was clicked', async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByRole('button', { name: /new structure/i }));

    await user.type(screen.getByLabelText(/employee/i), 'Kart');
    await user.click(await screen.findByRole('option'));

    expect(screen.getByLabelText(/employee/i)).toHaveValue('Karthik Reddy (TRG0006)');
  });

  it('sends the chosen employee id when the structure is saved', async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByRole('button', { name: /new structure/i }));

    await user.type(screen.getByLabelText(/employee/i), 'Kart');
    await user.click(await screen.findByRole('option'));
    await user.type(screen.getByLabelText(/^basic/i), '30000');
    await user.click(screen.getByRole('button', { name: /save structure/i }));

    await waitFor(() => expect(createStructure).toHaveBeenCalled());
    expect(createStructure.mock.calls[0][0]).toMatchObject({ employee: 6 });
  });

  it('says so when nobody matches', async () => {
    employeeList.mockResolvedValue({ count: 0, results: [] });
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByRole('button', { name: /new structure/i }));

    await user.type(screen.getByLabelText(/employee/i), 'zzzz');

    expect(await screen.findByText(/nobody matches/i)).toBeInTheDocument();
  });
});
