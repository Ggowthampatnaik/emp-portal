/**
 * Who gets a way out of the summary card.
 *
 * For the oversight roles this card is the record: their Employees list opens
 * it instead of the page, and the page holds nothing more - Admin's is the
 * employment panel plus assets, Super Admin's stops at employment and contact.
 * So the card is a dead end on purpose. HR and a manager still get "Open full
 * record", because for them there is a fuller record on the other side of it.
 */

import { MemoryRouter } from 'react-router-dom';
import type * as router from 'react-router-dom';
import { Provider } from 'react-redux';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import { setUser } from '@/features/auth/authSlice';
import { makeUser, superAdminUser } from '@/test/fixtures';
import type { CurrentUser, PermissionCode, RoleSlug } from '@/types/auth';
import type { DirectoryDetail } from '@/types/domain';

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof router>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

const directoryEntry = vi.fn();
vi.mock('@/services/api/services', () => ({
  employeesApi: { directoryEntry: (...args: unknown[]) => directoryEntry(...args) },
}));

const { default: EmployeeDetailsDialog } =
  await import('@/features/employees/EmployeeDetailsDialog');

const SNEHA = {
  id: 1,
  employee_code: 'TRG0001',
  full_name: 'Sneha Kulkarni',
  email: 'sneha.kulkarni@trigyan.io',
  department_name: 'Engineering',
  designation_name: 'Director',
  reporting_manager: null,
  reporting_manager_name: null,
  direct_report_count: 0,
  phone: '+919876543210',
  direct_reports: [],
  date_of_joining: '2018-04-02',
  work_location: 'Hyderabad',
  photo_url: null,
} as unknown as DirectoryDetail;

const withRoles = (email: string, roles: RoleSlug[], permissions: PermissionCode[]) =>
  makeUser({ email, roles, permissions });

const adminUser = withRoles(
  'rahul.iyer@trigyan.io',
  ['employee', 'admin'],
  ['employee.view_self', 'employee.view_all', 'employee.edit'],
);
const hrUser = withRoles(
  'priya.menon@trigyan.io',
  ['employee', 'hr'],
  ['employee.view_self', 'employee.view_all'],
);
const managerUser = withRoles(
  'vikram.nair@trigyan.io',
  ['employee', 'manager'],
  ['employee.view_self', 'employee.view_team'],
);

function renderDialog(user: CurrentUser) {
  const store = createStore();
  store.dispatch(setUser(user));
  render(
    <Provider store={store}>
      <MemoryRouter>
        <EmployeeDetailsDialog employeeId={1} onClose={vi.fn()} onNavigate={vi.fn()} />
      </MemoryRouter>
    </Provider>,
  );
}

describe('EmployeeDetailsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    directoryEntry.mockResolvedValue(SNEHA);
  });

  it('shows the mobile number, formatted, as plain text', async () => {
    renderDialog(hrUser);

    const number = await screen.findByText('+91 98765 43210');
    expect(number.closest('a')).toBeNull(); // not clickable
    expect(screen.getByText('Mobile')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy mobile number' })).toBeInTheDocument();
  });

  it('says "Not recorded" when there is no mobile number', async () => {
    directoryEntry.mockResolvedValue({ ...SNEHA, phone: '' });
    renderDialog(hrUser);

    expect(await screen.findByText('Not recorded')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Copy mobile number' }),
    ).not.toBeInTheDocument();
  });

  // The card is a summary only: nobody, whatever their role, is offered a way
  // through to the full record page from it. Closing is the only way out.
  it.each([
    ['an Admin', () => adminUser],
    ['HR', () => hrUser],
    ['a manager', () => managerUser],
    ['a Super Admin', () => superAdminUser],
    ['a plain employee', () => makeUser()],
  ])('offers %s no way through to the full record', async (_who, user) => {
    renderDialog(user());

    await screen.findByText('Sneha Kulkarni');
    expect(screen.queryByRole('button', { name: /open full record/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Close' }).length).toBeGreaterThan(0);
  });
});
