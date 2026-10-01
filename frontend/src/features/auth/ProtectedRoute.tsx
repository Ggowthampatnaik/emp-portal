/** Route guards: authentication first, then role / permission checks. */

import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useAppSelector } from '@/app/hooks';
import LoadingScreen from '@/components/common/LoadingScreen';
import { selectIsAuthenticated, selectIsInitialising } from '@/features/auth/authSlice';
import { usePermissions } from '@/hooks/usePermissions';
import type { PermissionCode, RoleSlug } from '@/types/auth';

/** Blocks anonymous users and remembers where they were headed. */
export function ProtectedRoute() {
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const initialising = useAppSelector(selectIsInitialising);
  const location = useLocation();

  if (initialising) return <LoadingScreen message="Restoring your session..." />;
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  return <Outlet />;
}

interface RequireAccessProps {
  roles?: RoleSlug[];
  permissions?: PermissionCode[];
  /** When true, every listed permission is required instead of any one of them. */
  requireAll?: boolean;
}

/** Guards a subtree behind roles and/or permission codes. */
export function RequireAccess({ roles, permissions, requireAll = false }: RequireAccessProps) {
  const { hasRole, can, canAny } = usePermissions();

  const roleOk = !roles?.length || hasRole(...roles);
  const permissionOk =
    !permissions?.length || (requireAll ? can(...permissions) : canAny(...permissions));

  if (!roleOk || !permissionOk) return <Navigate to="/forbidden" replace />;
  return <Outlet />;
}
