/**
 * Permission helpers for components. The backend enforces the same rules on
 * every request - this only decides what to render.
 */

import { useAppSelector } from '@/app/hooks';
import { selectCurrentUser } from '@/features/auth/authSlice';
import { PRIVILEGED_ROLES, ROLES, type PermissionCode, type RoleSlug } from '@/types/auth';

export function usePermissions() {
  const user = useAppSelector(selectCurrentUser);
  const roles = user?.roles ?? [];
  const isSuperAdmin = roles.includes(ROLES.SUPER_ADMIN);

  return {
    user,
    roles,
    isSuperAdmin,
    isPrivileged: roles.some((role) => PRIVILEGED_ROLES.includes(role)),
    isManager: isSuperAdmin || roles.includes(ROLES.MANAGER),
    /** True when the user holds every one of the given permission codes. */
    can: (...codes: PermissionCode[]): boolean =>
      isSuperAdmin || codes.every((code) => user?.permissions.includes(code) === true),
    /** True when the user holds at least one of the given permission codes. */
    canAny: (...codes: PermissionCode[]): boolean =>
      isSuperAdmin || codes.some((code) => user?.permissions.includes(code) === true),
    hasRole: (...wanted: RoleSlug[]): boolean =>
      isSuperAdmin || wanted.some((role) => roles.includes(role)),
  };
}
