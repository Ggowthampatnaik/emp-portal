/**
 * What a click on a person does, per role.
 *
 * The oversight roles - Admin and Super Admin - open somebody to answer "who is
 * this" far more often than to change anything, so a click gives them the
 * summary card, and for both of them that card is the record: neither of their
 * record pages holds anything more. HR maintains records, so their click goes
 * straight there.
 */

import { MemoryRouter } from 'react-router-dom';
import type * as router from 'react-router-dom';
import { Provider } from 'react-redux';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import { setUser } from '@/features/auth/authSlice';
import { makeUser, superAdminUser } from '@/test/fixtures';
import type { CurrentUser, PermissionCode, RoleSlug } from '@/types/auth';

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof router>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

const list = vi.fn();
vi.mock('@/services/api/services', () => ({
  employeesApi: {
    list: (...args: unknown[]) => list(...args),
    departments: vi.fn(() => Promise.resolve({ results: [] })),
  },
  // Super Admin's row renders the inline RoleSelect, which reaches for this.
  adminApi: { setRoles: vi.fn() },
}));

/** The card under test is the click target, not the dialog's contents. */
vi.mock('@/features/employees/EmployeeDetailsDialog', () => ({
  default: ({ employeeId }: { employeeId: number | null }) =>
    employeeId === null ? null : <div>Employee details for {employeeId}</div>,
}));
vi.mock('@/features/employees/DirectoryView', () => ({ default: () => <div>Directory</div> }));
vi.mock('@/features/employees/EmployeeFormDialog', () => ({ default: () => null }));
vi.mock('@/features/employees/ChangeRoleDialog', () => ({ default: () => null }));

const { default: EmployeesPage } = await import('@/features/employees/EmployeesPage');

const ANANYA = {
  id: 13,
  employee_code: 'TRG0013',
  full_name: 'Ananya Gupta',
  email: 'ananya.gupta@trigyan.io',
  department_name: 'Engineering',
  designation_name: 'Trainee Engineer',
  reporting_manager_name: 'Meera Joshi',
  date_of_joining: '2024-06-03',
  employment_status: 'active',
  photo_url: null,
  user_id: 13,
  roles: ['employee'],
  work_location: 'Hyderabad',
  skills: [],
};

const adminUser = makeUser({
  email: 'rahul.iyer@trigyan.io',
  roles: ['employee', 'admin'] as RoleSlug[],
  permissions: [
    'employee.view_self',
    'employee.view_all',
    'employee.edit',
    'admin.manage_roles',
  ] as PermissionCode[],
});

const hrUser = makeUser({
  email: 'priya.menon@trigyan.io',
  roles: ['employee', 'hr'] as RoleSlug[],
  permissions: ['employee.view_self', 'employee.view_all', 'employee.edit'] as PermissionCode[],
});

function renderPage(user: CurrentUser) {
  const store = createStore();
  store.dispatch(setUser(user));
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/employees']}>
        <EmployeesPage />
      </MemoryRouter>
    </Provider>,
  );
}

/**
 * The name is the click surface in both layouts - a card for most roles, a
 * table row for Super Admin.
 */
async function clickAnanya() {
  const card = await screen.findByText('Ananya Gupta');
  await userEvent.click(card);
}

describe('EmployeesPage, opening a person', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    list.mockResolvedValue({ count: 1, next: null, previous: null, results: [ANANYA] });
  });

  it('shows Admin the summary card instead of loading the record page', async () => {
    renderPage(adminUser);
    await clickAnanya();

    expect(await screen.findByText('Employee details for 13')).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('takes HR straight to the record page', async () => {
    renderPage(hrUser);
    await clickAnanya();

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/employees/13'));
    expect(screen.queryByText('Employee details for 13')).not.toBeInTheDocument();
  });

  it('shows Super Admin the summary card too', async () => {
    // Their list is the table, so the click lands on a row rather than a card,
    // and it opens the same summary the card grid does for Admin.
    renderPage(superAdminUser);
    await clickAnanya();

    expect(await screen.findByText('Employee details for 13')).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not mount the dialog until Admin opens someone', async () => {
    renderPage(adminUser);

    await screen.findByText('Ananya Gupta');
    expect(screen.queryByText(/Employee details for/)).not.toBeInTheDocument();
  });
});

describe('EmployeesPage, the Role column', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    list.mockResolvedValue({ count: 1, next: null, previous: null, results: [ANANYA] });
  });

  /**
   * The table is behind the Cards/Table toggle for everyone but Super Admin,
   * who has no toggle because the table is their only layout.
   */
  async function showTable({ superAdmin = false } = {}) {
    await screen.findByText('Ananya Gupta');
    if (!superAdmin) await userEvent.click(screen.getByRole('button', { name: /table/i }));
    return screen.findByRole('table');
  }

  it('is not in the table for Admin', async () => {
    renderPage(adminUser);
    const table = await showTable();

    expect(within(table).queryByRole('columnheader', { name: 'Role' })).not.toBeInTheDocument();
    expect(
      within(table).queryByRole('button', { name: 'Change role' }),
    ).not.toBeInTheDocument();
  });

  it('keeps every other column for Admin', async () => {
    renderPage(adminUser);
    const table = await showTable();

    for (const heading of [
      'Employee ID',
      'Name',
      'Department',
      'Designation',
      'Reports to',
      'Joined',
    ]) {
      expect(within(table).getByRole('columnheader', { name: heading })).toBeInTheDocument();
    }
  });

  it('is in the table for HR', async () => {
    renderPage(hrUser);
    const table = await showTable();

    expect(within(table).getByRole('columnheader', { name: 'Role' })).toBeInTheDocument();
  });

  it('is in the table for Super Admin', async () => {
    renderPage(superAdminUser);
    const table = await showTable({ superAdmin: true });

    expect(within(table).getByRole('columnheader', { name: 'Role' })).toBeInTheDocument();
  });
});

describe('EmployeesPage, the list layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    list.mockResolvedValue({ count: 1, next: null, previous: null, results: [ANANYA] });
  });

  it('gives Super Admin the table and no card view to switch to', async () => {
    renderPage(superAdminUser);

    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /card view/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /table view/i })).not.toBeInTheDocument();
  });

  it('still opens on cards for everyone else', async () => {
    renderPage(hrUser);

    await screen.findByText('Ananya Gupta');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /card view/i })).toBeInTheDocument();
  });
});

describe('EmployeesPage, the caller themselves', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    list.mockResolvedValue({ count: 1, next: null, previous: null, results: [ANANYA] });
  });

  it('asks the server to leave them out of the list', async () => {
    renderPage(hrUser);

    await waitFor(() => expect(list).toHaveBeenCalled());
    // Server-side, so the "N employees" line and the pager stay honest -
    // dropping a row from a fetched page would leave 24 on one and 25 on
    // the next.
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ exclude_self: true }));
  });
});
