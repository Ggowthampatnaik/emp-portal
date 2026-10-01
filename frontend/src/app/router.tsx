/**
 * Route table. Module pages are lazy-loaded so each feature ships as its own
 * chunk; every authenticated route sits behind ProtectedRoute, and privileged
 * areas add a RequireAccess guard that mirrors the backend permission codes.
 */

import { lazy } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';

import AppLayout from '@/components/layout/AppLayout';
import { ForbiddenPage, NotFoundPage } from '@/components/common/ErrorPages';
import RouteError from '@/components/common/RouteError';
import LoginPage from '@/features/auth/LoginPage';
import { ProtectedRoute, RequireAccess } from '@/features/auth/ProtectedRoute';

const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage'));
const ChangePasswordPage = lazy(() => import('@/features/auth/ChangePasswordPage'));
const EmployeesPage = lazy(() => import('@/features/employees/EmployeesPage'));
const EmployeeDetailPage = lazy(() => import('@/features/employees/EmployeeDetailPage'));
const DepartmentsPage = lazy(() => import('@/features/employees/DepartmentsPage'));
const OrgChartPage = lazy(() => import('@/features/employees/OrgChartPage'));
const ProjectsPage = lazy(() => import('@/features/projects/ProjectsPage'));
const LeavePage = lazy(() => import('@/features/leave/LeavePage'));
const HolidaysPage = lazy(() => import('@/features/leave/HolidaysPage'));
const OnLeaveTodayPage = lazy(() => import('@/features/leave/OnLeaveTodayPage'));
const BirthdaysPage = lazy(() => import('@/features/employees/BirthdaysPage'));
const TimesheetsPage = lazy(() => import('@/features/timesheet/TimesheetsPage'));
const ReportsPage = lazy(() => import('@/features/reports/ReportsPage'));
const ReportRowPage = lazy(() => import('@/features/reports/ReportRowPage'));
const AdministrationPage = lazy(() => import('@/features/admin/AdministrationPage'));
const NotificationsPage = lazy(() => import('@/features/notifications/NotificationsPage'));
const PayrollPage = lazy(() => import('@/features/payroll/PayrollPage'));
const CompleteProfilePage = lazy(() => import('@/features/auth/CompleteProfilePage'));
const ForgotPasswordPage = lazy(() => import('@/features/auth/ForgotPasswordPage'));
const FinancePage = lazy(() => import('@/features/finance/FinancePage'));
const MyAssetsPage = lazy(() => import('@/features/assets/MyAssetsPage'));

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage />, errorElement: <RouteError /> },
  { path: '/forgot-password', element: <ForgotPasswordPage />, errorElement: <RouteError /> },
  { path: '/forbidden', element: <ForbiddenPage />, errorElement: <RouteError /> },
  {
    element: <ProtectedRoute />,
    // Covers every authenticated page, which is where the lazy chunks are.
    errorElement: <RouteError />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'dashboard', element: <Navigate to="/" replace /> },
          { path: 'change-password', element: <ChangePasswordPage /> },
          // The onboarding wizard. Reachable while the profile gate is
          // closed, which is the whole point of it.
          { path: 'complete-profile', element: <CompleteProfilePage /> },
          { path: 'profile', element: <EmployeeDetailPage self /> },
          { path: 'notifications', element: <NotificationsPage /> },
          // Everyone's own register. No guard: the page asks for the
          // caller's own assets and the server scopes it to them.
          { path: 'assets', element: <MyAssetsPage /> },

          { path: 'leave', element: <LeavePage /> },
          // The same page, opened on a particular tab. Dashboard cards and
          // notifications link straight to the thing they are about rather
          // than to the page's first tab.
          { path: 'leave/requests', element: <LeavePage /> },
          { path: 'holidays', element: <HolidaysPage /> },
          { path: 'birthdays', element: <BirthdaysPage /> },
          { path: 'leave/approvals', element: <LeavePage /> },
          { path: 'timesheets', element: <TimesheetsPage /> },
          { path: 'timesheets/approvals', element: <TimesheetsPage /> },

          { path: 'payroll', element: <PayrollPage /> },
          { path: 'projects', element: <ProjectsPage /> },

          // The company directory is open to every signed-in user; the page
          // itself decides what to show. Full records, the org chart and
          // department admin stay permission-gated.
          { path: 'employees', element: <EmployeesPage /> },
          {
            element: (
              <RequireAccess permissions={['employee.view_team', 'employee.view_all']} />
            ),
            children: [
              { path: 'employees/departments', element: <DepartmentsPage /> },
              { path: 'employees/org-chart', element: <OrgChartPage /> },
              { path: 'employees/:id', element: <EmployeeDetailPage /> },
            ],
          },
          {
            // Who is out today, company-wide. The dashboard's "On leave today"
            // card links here; seeing everybody's leave is HR's and an
            // administrator's, which is what `leave.view_all` means.
            element: <RequireAccess permissions={['leave.view_all']} />,
            children: [{ path: 'leave/on-leave-today', element: <OnLeaveTodayPage /> }],
          },
          {
            // Finance is its own module and its own role; nothing else on the
            // portal is behind `finance.view`.
            element: <RequireAccess permissions={['finance.view']} />,
            children: [{ path: 'finance', element: <FinancePage /> }],
          },
          {
            element: (
              <RequireAccess
                permissions={[
                  'report.employee',
                  'report.leave',
                  'report.timesheet',
                  'report.project',
                ]}
              />
            ),
            children: [
              { path: 'reports', element: <ReportsPage /> },
              // One row of one report, drawn against the rest of it. The row
              // is addressed by its own values because report rows are
              // aggregates and carry no id. The page checks the permission
              // for the particular report on top of this guard - holding
              // `report.leave` is not holding `report.project`.
              { path: 'reports/:kind/:rowKey', element: <ReportRowPage /> },
            ],
          },
          {
            element: (
              <RequireAccess
                permissions={[
                  'admin.manage_users',
                  'admin.manage_roles',
                  'admin.system_config',
                ]}
              />
            ),
            children: [{ path: 'administration', element: <AdministrationPage /> }],
          },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage />, errorElement: <RouteError /> },
]);
