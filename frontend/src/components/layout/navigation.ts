/**
 * Sidebar definition. Each item declares the permission codes that make it
 * visible, so navigation and route guards are driven by the same data.
 */

import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import AssessmentIcon from '@mui/icons-material/Assessment';
import BadgeIcon from '@mui/icons-material/Badge';
import DashboardIcon from '@mui/icons-material/Dashboard';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import ScheduleIcon from '@mui/icons-material/Schedule';
import CelebrationIcon from '@mui/icons-material/Celebration';
import PaymentsIcon from '@mui/icons-material/Payments';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import DevicesIcon from '@mui/icons-material/Devices';
import WorkIcon from '@mui/icons-material/Work';
import type { SvgIconComponent } from '@mui/icons-material';

import type { PermissionCode } from '@/types/auth';

export interface NavItem {
  label: string;
  path: string;
  icon: SvgIconComponent;
  /** Visible when the user holds at least one of these codes. Empty = always. */
  permissions: PermissionCode[];
  /**
   * Hidden from Super Admin even though the role passes every permission
   * check. Their sidebar is deliberately just Dashboard and Employees - the
   * oversight view - rather than every module in the company.
   */
  hiddenForSuperAdmin?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  {
    label: 'Dashboard',
    path: '/',
    icon: DashboardIcon,
    permissions: [],
    hiddenForSuperAdmin: true,
  },
  {
    // Everyone reaches the company directory here; the page itself adds the
    // management table for those who may see full records.
    label: 'Employees',
    path: '/employees',
    icon: BadgeIcon,
    permissions: [],
  },
  {
    label: 'Projects',
    hiddenForSuperAdmin: true,
    path: '/projects',
    icon: WorkIcon,
    permissions: ['project.view', 'project.view_all'],
  },
  {
    label: 'Leave',
    hiddenForSuperAdmin: true,
    path: '/leave',
    icon: EventAvailableIcon,
    permissions: ['leave.view_self', 'leave.view_team', 'leave.view_all'],
  },
  {
    // Open to everyone: the dashboard card's "View More" lands here.
    label: 'Holidays',
    hiddenForSuperAdmin: true,
    path: '/holidays',
    icon: CelebrationIcon,
    permissions: [],
  },
  {
    label: 'Timesheets',
    hiddenForSuperAdmin: true,
    path: '/timesheets',
    icon: ScheduleIcon,
    permissions: ['timesheet.view_self', 'timesheet.view_team', 'timesheet.view_all'],
  },
  {
    // Everyone reaches their own payslips; the page adds the HR and approval
    // tabs for those who hold the permissions.
    label: 'Payslip',
    hiddenForSuperAdmin: true,
    path: '/payroll',
    icon: PaymentsIcon,
    permissions: ['payroll.view_self', 'payroll.view_all'],
  },
  {
    // Its own module, not a payroll tab: Payroll works out what people are
    // paid, Finance decides when it goes out.
    label: 'Finance',
    hiddenForSuperAdmin: true,
    path: '/finance',
    icon: AccountBalanceWalletIcon,
    permissions: ['finance.view'],
  },
  {
    // Everyone holds something eventually - a laptop at least - so this is
    // ungated. The page shows the caller's own register and nobody else's.
    label: 'Assets',
    hiddenForSuperAdmin: true,
    path: '/assets',
    icon: DevicesIcon,
    permissions: [],
  },
  {
    label: 'Reports',
    hiddenForSuperAdmin: true,
    path: '/reports',
    icon: AssessmentIcon,
    permissions: ['report.employee', 'report.leave', 'report.timesheet', 'report.project'],
  },
  {
    label: 'Administration',
    hiddenForSuperAdmin: true,
    path: '/administration',
    icon: AdminPanelSettingsIcon,
    permissions: ['admin.manage_users', 'admin.manage_roles', 'admin.system_config'],
  },
];
