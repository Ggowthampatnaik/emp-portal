/**
 * Which half of a record each viewer gets.
 *
 * Super Admin's Employees module is oversight: who works here, and who reports
 * to whom. The operational cards - skills, experience, documents, assets and
 * bank details - belong to the roles that run them, so the record stops at the
 * employment and contact panels. HR opening the same record still sees all of
 * it, and a Super Admin's own My profile page is a person looking at their own
 * data rather than the module, so it keeps every card too.
 */

import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import { setUser } from '@/features/auth/authSlice';
import { makeUser, superAdminUser } from '@/test/fixtures';
import type { CurrentUser, PermissionCode, RoleSlug } from '@/types/auth';
import type { EmployeeDetail } from '@/types/domain';

const detail = vi.fn();
const me = vi.fn();

vi.mock('@/services/api/services', () => ({
  employeesApi: {
    detail: (...args: unknown[]) => detail(...args),
    me: (...args: unknown[]) => me(...args),
    update: vi.fn(),
    departments: vi.fn(() => Promise.resolve({ results: [] })),
    designations: vi.fn(() => Promise.resolve({ results: [] })),
    // The cards below are stubbed out, but the page's own imports resolve
    // through this module, so every name it reaches for has to exist.
    employeeSkills: vi.fn(() => Promise.resolve([])),
    experience: vi.fn(() => Promise.resolve([])),
    documents: vi.fn(() => Promise.resolve([])),
    assets: vi.fn(() => Promise.resolve([])),
    bankAccount: vi.fn(() => Promise.resolve(null)),
    deletionRequest: vi.fn(() => Promise.resolve(null)),
    uploadPhoto: vi.fn(),
    removePhoto: vi.fn(),
  },
}));

/** The cards are covered by their own tests; here only their presence matters. */
const stub = (label: string) => ({ default: () => <div>{label}</div> });
vi.mock('@/features/employees/SkillsCard', () => stub('Skills card'));
vi.mock('@/features/employees/ExperienceCard', () => stub('Experience card'));
vi.mock('@/features/employees/DocumentsCard', () => stub('Documents card'));
vi.mock('@/features/employees/AssetsCard', () => stub('Assets card'));
vi.mock('@/features/employees/BankDetailsCard', () => stub('Bank details card'));
vi.mock('@/features/employees/DeleteProfileCard', () => stub('Account closure card'));
vi.mock('@/features/employees/ProfilePhoto', () => stub('Photo'));

const { default: EmployeeDetailPage } = await import('@/features/employees/EmployeeDetailPage');

const hrUser = makeUser({
  email: 'priya.menon@trigyan.io',
  roles: ['employee', 'hr'] as RoleSlug[],
  permissions: [
    'employee.view_self',
    'employee.view_all',
    'employee.edit',
    'bank.manage',
    'skill.manage',
    'asset.manage',
  ] as PermissionCode[],
});

const adminUser = makeUser({
  email: 'rahul.iyer@trigyan.io',
  roles: ['employee', 'admin'] as RoleSlug[],
  permissions: [
    'employee.view_self',
    'employee.view_all',
    'employee.edit',
    'asset.manage',
    'admin.manage_users',
  ] as PermissionCode[],
});

/** Staffing, paperwork and pay: HR's and the employee's, never an oversight role's. */
const PERSONAL = ['Skills card', 'Experience card', 'Documents card', 'Bank details card'];
const OPERATIONAL = [...PERSONAL, 'Assets card'];

const SNEHA = {
  id: 1,
  employee_code: 'TRG0001',
  full_name: 'Sneha Kulkarni',
  first_name: 'Sneha',
  last_name: 'Kulkarni',
  email: 'sneha.kulkarni@trigyan.io',
  department_name: 'Engineering',
  designation_name: 'Director',
  employment_status: 'active',
  date_of_joining: '2019-01-07',
  reporting_manager_name: null,
  phone: '+91 98000 00001',
  photo_url: null,
  roles: ['super_admin'],
} as unknown as EmployeeDetail;

function renderPage(user: CurrentUser, { self = false } = {}) {
  const store = createStore();
  store.dispatch(setUser(user));
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[self ? '/profile' : '/employees/1']}>
        <EmployeeDetailPage self={self} />
      </MemoryRouter>
    </Provider>,
  );
}

describe('EmployeeDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    detail.mockResolvedValue(SNEHA);
    me.mockResolvedValue(SNEHA);
  });

  it('leaves the operational cards off the record for a Super Admin', async () => {
    renderPage(superAdminUser);

    await screen.findByText('Sneha Kulkarni');
    for (const card of OPERATIONAL) {
      expect(screen.queryByText(card)).not.toBeInTheDocument();
    }
  });

  it('keeps the employment and contact panels for a Super Admin', async () => {
    renderPage(superAdminUser);

    await screen.findByText('Sneha Kulkarni');
    expect(screen.getByText('TRG0001')).toBeInTheDocument();
    expect(screen.getByText('Director')).toBeInTheDocument();
  });

  it('gives a Super Admin every card on their own profile page', async () => {
    renderPage(superAdminUser, { self: true });

    await waitFor(() => expect(me).toHaveBeenCalled());
    for (const card of OPERATIONAL) {
      expect(await screen.findByText(card)).toBeInTheDocument();
    }
  });

  it('leaves the personal records off the record for an Admin', async () => {
    renderPage(adminUser);

    await screen.findByText('Sneha Kulkarni');
    for (const card of PERSONAL) {
      expect(screen.queryByText(card)).not.toBeInTheDocument();
    }
  });

  it('keeps the asset register for an Admin, whose job it is', async () => {
    renderPage(adminUser);

    expect(await screen.findByText('Assets card')).toBeInTheDocument();
  });

  it('gives an Admin every card on their own profile page', async () => {
    renderPage(adminUser, { self: true });

    await waitFor(() => expect(me).toHaveBeenCalled());
    for (const card of OPERATIONAL) {
      expect(await screen.findByText(card)).toBeInTheDocument();
    }
  });

  it('gives HR the whole record', async () => {
    renderPage(hrUser);

    await screen.findByText('Sneha Kulkarni');
    for (const card of OPERATIONAL) {
      expect(await screen.findByText(card)).toBeInTheDocument();
    }
  });

  it('gives an employee the whole of their own record', async () => {
    renderPage(makeUser({ email: SNEHA.email }), { self: true });

    await waitFor(() => expect(me).toHaveBeenCalled());
    for (const card of OPERATIONAL) {
      expect(await screen.findByText(card)).toBeInTheDocument();
    }
  });
});
