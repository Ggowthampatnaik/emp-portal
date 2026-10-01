import type { CurrentUser, PermissionCode, RoleSlug } from '@/types/auth';

/** Builds a CurrentUser for tests; defaults to a plain employee. */
export function makeUser(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: 1,
    uuid: '11111111-1111-1111-1111-111111111111',
    email: 'employee@trigyan.io',
    first_name: 'Asha',
    last_name: 'Rao',
    full_name: 'Asha Rao',
    is_active: true,
    roles: ['employee'] as RoleSlug[],
    permissions: [
      'employee.view_self',
      'leave.apply',
      'leave.view_self',
      'timesheet.submit',
      'timesheet.view_self',
      'project.view',
    ] as PermissionCode[],
    employee_id: 10,
    employee_code: 'TRG0005',
    photo_url: null,
    must_change_password: false,
    profile_completed: true,
    last_login_at: null,
    ...overrides,
  };
}

export const managerUser = makeUser({
  email: 'manager@trigyan.io',
  first_name: 'Vikram',
  last_name: 'Nair',
  full_name: 'Vikram Nair',
  roles: ['employee', 'manager'] as RoleSlug[],
  permissions: [
    'employee.view_self',
    'employee.view_team',
    'leave.apply',
    'leave.view_self',
    'leave.view_team',
    'leave.approve',
    'timesheet.view_team',
    'timesheet.approve',
    'report.leave',
  ] as PermissionCode[],
});

export const superAdminUser = makeUser({
  email: 'root@trigyan.io',
  roles: ['super_admin'] as RoleSlug[],
  permissions: [] as PermissionCode[],
});
