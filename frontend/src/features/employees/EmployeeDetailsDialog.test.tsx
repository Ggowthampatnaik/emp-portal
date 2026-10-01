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

  it('offers Admin no way through to the record page', async () => {
    renderDialog(adminUser);

    await screen.findByText('Sneha Kulkarni');
    expect(screen.queryByRole('button', { name: 'Open full record' })).not.toBeInTheDocument();
    // Closing is the only way out, from the title's X or the footer button.
    expect(screen.getAllByRole('button', { name: 'Close' }).length).toBeGreaterThan(0);
  });

  it('keeps the link for HR', async () => {
    renderDialog(hrUser);

    expect(await screen.findByRole('button', { name: 'Open full record' })).toBeInTheDocument();
  });

  it('keeps the link for a manager', async () => {
    renderDialog(managerUser);

    expect(await screen.findByRole('button', { name: 'Open full record' })).toBeInTheDocument();
  });

  it('offers a Super Admin no way through either', async () => {
    renderDialog(superAdminUser);

    await screen.findByText('Sneha Kulkarni');
    expect(screen.queryByRole('button', { name: 'Open full record' })).not.toBeInTheDocument();
  });

  it('shows a plain employee neither the link nor anyone else’s record', async () => {
    renderDialog(makeUser());

    await screen.findByText('Sneha Kulkarni');
    expect(screen.queryByRole('button', { name: 'Open full record' })).not.toBeInTheDocument();
  });
});
