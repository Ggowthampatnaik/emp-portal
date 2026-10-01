/**
 * Identity types. The role slugs and permission codes mirror
 * backend/common/enums.py and the seed_rbac management command - if a code is
 * added there, add it here so the compiler catches typos in route guards.
 */

export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  HR: 'hr',
  MANAGER: 'manager',
  /** Releases payslips for payment. Sees pay figures and nothing else. */
  FINANCE: 'finance',
  EMPLOYEE: 'employee',
} as const;

export type RoleSlug = (typeof ROLES)[keyof typeof ROLES];

/**
 * How a role is written when shown to someone. Lives here beside the slugs so
 * the topbar chip and the Administration table cannot drift apart.
 */
export const ROLE_LABELS: Record<string, string> = {
  [ROLES.SUPER_ADMIN]: 'Super Admin',
  [ROLES.ADMIN]: 'Admin',
  [ROLES.HR]: 'HR',
  [ROLES.MANAGER]: 'Manager',
  [ROLES.FINANCE]: 'Finance',
  [ROLES.EMPLOYEE]: 'Employee',
};

/** Roles with org-wide visibility. */
export const PRIVILEGED_ROLES: RoleSlug[] = [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR];

export type PermissionCode =
  | 'employee.view_self'
  | 'employee.edit_self'
  | 'employee.view_team'
  | 'employee.view_all'
  | 'employee.create'
  | 'employee.edit'
  | 'employee.deactivate'
  | 'department.manage'
  | 'employee.request_deletion'
  | 'employee.approve_deletion'
  | 'bank.view_self'
  | 'bank.manage'
  | 'asset.manage'
  | 'skill.manage'
  | 'project.view'
  | 'project.view_all'
  | 'project.manage'
  | 'project.assign_team'
  | 'project.allocate'
  | 'leave.apply'
  | 'leave.view_self'
  | 'leave.view_team'
  | 'leave.view_all'
  | 'leave.approve'
  | 'leave.cancel_any'
  | 'leave.manage_policy'
  | 'timesheet.submit'
  | 'timesheet.view_self'
  | 'timesheet.view_team'
  | 'timesheet.view_all'
  | 'timesheet.approve'
  | 'timesheet.notify'
  | 'payroll.view_self'
  | 'payroll.view_all'
  | 'payroll.manage'
  | 'payroll.process'
  | 'payroll.approve'
  | 'payroll.push_to_finance'
  | 'finance.view'
  | 'finance.approve'
  | 'report.employee'
  | 'report.leave'
  | 'report.timesheet'
  | 'report.project'
  | 'report.export'
  | 'admin.manage_users'
  | 'admin.manage_roles'
  | 'admin.system_config'
  | 'admin.view_audit_log';

export interface LoginCredentials {
  email: string;
  password: string;
}

/** What the sign-in form submits: the credentials, plus how long to keep them. */
export interface SignInRequest extends LoginCredentials {
  /** Keep the session across browser restarts (see tokenStorage). */
  remember?: boolean;
}

export interface CurrentUser {
  id: number;
  uuid: string;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  is_active: boolean;
  roles: RoleSlug[];
  permissions: PermissionCode[];
  employee_id: number | null;
  employee_code: string | null;
  photo_url: string | null;
  must_change_password: boolean;
  /** False until the Complete Profile wizard has been finished (F18). */
  profile_completed: boolean;
  last_login_at: string | null;
}

export interface TokenPair {
  access: string;
  refresh: string;
}

export interface EntraExchangeResponse extends TokenPair {
  user: CurrentUser;
}
