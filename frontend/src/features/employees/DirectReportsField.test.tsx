/**
 * Direct reports by name, and HR changing them in one save.
 */

import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import type { EmployeeListItem } from '@/types/domain';

const directReports = vi.fn();
const setDirectReports = vi.fn();
const list = vi.fn();

vi.mock('@/services/api/services', () => ({
  employeesApi: {
    directReports: (...args: unknown[]) => directReports(...args),
    setDirectReports: (...args: unknown[]) => setDirectReports(...args),
    list: (...args: unknown[]) => list(...args),
    detail: vi.fn(),
  },
}));

const { default: DirectReportsField } = await import('@/features/employees/DirectReportsField');

function person(id: number, name: string, code: string): EmployeeListItem {
  return {
    id,
    employee_code: code,
    full_name: name,
    email: `${name.split(' ')[0]!.toLowerCase()}@trigyan.io`,
    photo_url: null,
    department: null,
    department_name: 'Engineering',
    designation: null,
    designation_name: 'Engineer',
    reporting_manager: 4,
    reporting_manager_name: 'Vikram Nair',
    date_of_joining: '2024-01-01',
    employment_status: 'active',
    user_id: id + 100,
    roles: ['employee'],
    work_location: '',
    phone: '',
    asset_count: 0,
  };
}

const ASHA = person(5, 'Asha Rao', 'TRG0005');
const KARTHIK = person(6, 'Karthik Reddy', 'TRG0006');
const ROHAN = person(12, 'Rohan Desai', 'TRG0012');

function renderField(canManage: boolean) {
  render(
    <Provider store={createStore()}>
      <MemoryRouter>
        <DirectReportsField employeeId={4} employeeName="Vikram Nair" canManage={canManage} />
      </MemoryRouter>
    </Provider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  directReports.mockResolvedValue([ASHA, KARTHIK]);
  list.mockResolvedValue({ count: 1, results: [ROHAN] });
});

describe('DirectReportsField', () => {
  it('names the people who report here - names only, and not links', async () => {
    renderField(false);

    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
    expect(screen.getByText('Karthik Reddy')).toBeInTheDocument();
    expect(screen.queryByText(/Engineer/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('Direct reports (2)')).toBeInTheDocument();
  });

  it('offers no way to change them without employee.edit', async () => {
    renderField(false);
    await screen.findByText('Asha Rao');

    expect(screen.queryByRole('button', { name: 'Manage' })).not.toBeInTheDocument();
  });

  it('lets HR add one and remove another, saved as one list', async () => {
    const user = userEvent.setup();
    setDirectReports.mockResolvedValue([ASHA, ROHAN]);
    renderField(true);

    await user.click(await screen.findByRole('button', { name: 'Manage' }));
    const dialog = screen.getByRole('dialog');

    await user.click(within(dialog).getByLabelText(/add a direct report/i));
    await user.click(await screen.findByRole('option', { name: /Rohan Desai/ }));
    const karthik = within(dialog).getByRole('button', { name: /Karthik Reddy/ });
    await user.click(within(karthik).getByTestId('CancelIcon'));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(setDirectReports).toHaveBeenCalledWith(4, [5, 12]);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Rohan Desai')).toBeInTheDocument();
    expect(screen.queryByText('Karthik Reddy')).not.toBeInTheDocument();
  });

  it('shows why the server refused, and keeps the dialog open', async () => {
    const user = userEvent.setup();
    setDirectReports.mockRejectedValue({
      code: 'invalid',
      message: 'The submitted data is invalid.',
      requestId: 'r1',
      fieldErrors: {
        employee_ids:
          'Rohan Desai is above Vikram Nair in the reporting line, so cannot also report to them.',
      },
      status: 400,
    });
    renderField(true);

    await user.click(await screen.findByRole('button', { name: 'Manage' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText(/above Vikram Nair in the reporting line/),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
