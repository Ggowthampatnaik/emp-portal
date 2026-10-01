/**
 * Payroll.
 *
 * What you see depends on what you may do: every employee gets their own
 * payslips, HR gets salary structures and the monthly runs, and an
 * administrator gets the approval controls. The tabs are assembled from
 * permissions rather than roles, so a custom role composes correctly.
 */

import Card from '@mui/material/Card';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import { useState } from 'react';

import { EmptyState } from '@/components/common/Feedback';
import PageHeader from '@/components/common/PageHeader';
import MyPayslipsTab from '@/features/payroll/MyPayslipsTab';
import PayrollRunsTab from '@/features/payroll/PayrollRunsTab';
import ProjectPayslipsTab from '@/features/payroll/ProjectPayslipsTab';
import SalaryStructuresTab from '@/features/payroll/SalaryStructuresTab';
import { usePermissions } from '@/hooks/usePermissions';

export default function PayrollPage() {
  const { can, canAny } = usePermissions();
  const [tab, setTab] = useState(0);

  const tabs = [
    { label: 'My payslips', show: true, render: () => <MyPayslipsTab /> },
    {
      label: 'Payroll runs',
      show: canAny('payroll.process', 'payroll.approve', 'payroll.view_all'),
      render: () => <PayrollRunsTab />,
    },
    {
      // HR's other question: what is a project costing, rather than what did
      // this month cost.
      label: 'By project',
      show: can('payroll.view_all'),
      render: () => <ProjectPayslipsTab />,
    },
    {
      label: 'Salary structures',
      show: can('payroll.manage'),
      render: () => <SalaryStructuresTab />,
    },
  ].filter((entry) => entry.show);

  if (tabs.length === 0) {
    return (
      <>
        <PageHeader title="Payslip" />
        <EmptyState title="Payslips are not available to your account" />
      </>
    );
  }

  const active = tabs[Math.min(tab, tabs.length - 1)];

  return (
    <>
      <PageHeader
        title="Payslip"
        subtitle={
          tabs.length > 1 ? 'Payslips, monthly runs and salary structures' : 'Your payslips'
        }
      />
      <Card>
        <Tabs
          value={Math.min(tab, tabs.length - 1)}
          onChange={(_, next) => setTab(next)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}
        >
          {tabs.map((entry) => (
            <Tab key={entry.label} label={entry.label} />
          ))}
        </Tabs>
        {active.render()}
      </Card>
    </>
  );
}
