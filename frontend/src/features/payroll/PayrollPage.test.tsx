/** Which Payslip tabs each role is offered. */

import { Provider } from 'react-redux';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import { setUser } from '@/features/auth/authSlice';
import { makeUser } from '@/test/fixtures';
import type { PermissionCode, RoleSlug } from '@/types/auth';

// The tabs' own contents are tested on their own; here only which tabs appear.
vi.mock('@/features/payroll/MyPayslipsTab', () => ({ default: () => <div>my payslips</div> }));
vi.mock('@/features/payroll/PayrollRunsTab', () => ({ default: () => <div>runs</div> }));
vi.mock('@/features/payroll/ProjectPayslipsTab', () => ({
  default: () => <div>by project</div>,
}));
vi.mock('@/features/payroll/SalaryStructuresTab', () => ({
  default: () => <div>structures</div>,
}));

const { default: PayrollPage } = await import('@/features/payroll/PayrollPage');

const ADMIN: PermissionCode[] = ['payroll.view_all'];
const HR: PermissionCode[] = [
  'payroll.view_all',
  'payroll.manage',
  'payroll.process',
  'payroll.push_to_finance',
];

function renderAs(roles: RoleSlug[], permissions: PermissionCode[]) {
  const store = createStore();
  store.dispatch(setUser(makeUser({ roles, permissions })));
  render(
    <Provider store={store}>
      <PayrollPage />
    </Provider>,
  );
}

const tabNames = () => screen.getAllByRole('tab').map((tab) => tab.textContent);

describe('PayrollPage', () => {
  it('gives an Admin only their own payslips', () => {
    renderAs(['employee', 'admin'], ADMIN);

    expect(tabNames()).toEqual(['My payslips']);
  });

  it('keeps Payroll runs and By project for HR', () => {
    renderAs(['employee', 'hr'], HR);

    expect(tabNames()).toEqual([
      'My payslips',
      'Payroll runs',
      'By project',
      'Salary structures',
    ]);
  });

  it('keeps them for someone who is both Admin and HR', () => {
    renderAs(['employee', 'admin', 'hr'], [...ADMIN, ...HR]);

    expect(tabNames()).toContain('Payroll runs');
    expect(tabNames()).toContain('By project');
  });

  it('keeps them for a Super Admin, who approves the runs', () => {
    renderAs(['employee', 'super_admin'], []);

    expect(tabNames()).toContain('Payroll runs');
    expect(tabNames()).toContain('By project');
  });
});
