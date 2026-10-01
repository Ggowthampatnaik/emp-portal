/**
 * Leave management. One page, four tabs, because the whole leave story is
 * short: my balances, my requests, the approval queue (managers/HR) and the
 * holiday calendar.
 */

import AddIcon from '@mui/icons-material/Add';
import Card from '@mui/material/Card';
import Button from '@mui/material/Button';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import PageHeader from '@/components/common/PageHeader';
import QueueTabLabel from '@/components/common/QueueTabLabel';
import ApplyLeaveDialog from '@/features/leave/ApplyLeaveDialog';
import LeaveApprovalsTab from '@/features/leave/LeaveApprovalsTab';
import LeaveBalancesTab from '@/features/leave/LeaveBalancesTab';
import MyLeaveTab from '@/features/leave/MyLeaveTab';
import { usePermissions } from '@/hooks/usePermissions';
import { useApiResource } from '@/hooks/useApiResource';
import { leaveApi } from '@/services/api/services';

/** What a queue call resolves to when the caller may not see that queue. */
const EMPTY_PAGE = { count: 0, results: [] } as never;

export default function LeavePage() {
  const { can } = usePermissions();
  const mayApprove = can('leave.approve');
  // Stage two belongs to HR: approving leave company-wide, not just a branch.
  const mayApproveForHr = can('leave.approve', 'leave.view_all');

  // HR works the second stage and nothing else: it confirms or sends back, and
  // never sees the manager's queue.
  const showManagerQueue = mayApprove && !mayApproveForHr;

  // Tabs are conditional, so their indices are derived rather than hard-coded.
  const MANAGER_TAB = showManagerQueue ? 2 : -1;
  const HR_TAB = mayApproveForHr ? (showManagerQueue ? 3 : 2) : -1;

  /**
   * The address picks the tab, so a link can point at the thing it is about
   * rather than at the page's first tab. `/leave/requests` opens My requests;
   * `/leave/approvals` opens whichever queue the caller holds - HR approvals
   * for HR, Manager approvals for a manager. Plain `/leave` still opens My
   * balances, and so does anything else, including somebody with no queue
   * following an approvals link.
   *
   * Both dashboard cards and every leave notification point here. The page used
   * to ignore the path entirely, so all of them landed on My balances.
   */
  const { pathname } = useLocation();
  const queueTab = HR_TAB >= 0 ? HR_TAB : MANAGER_TAB;
  const tabForPath = pathname.endsWith('/requests')
    ? 1
    : pathname.endsWith('/approvals') && queueTab >= 0
      ? queueTab
      : 0;

  const [tab, setTab] = useState(tabForPath);
  const [applying, setApplying] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Following a second link while already on the page has to move the tab too;
  // React keeps this component mounted across the two routes.
  useEffect(() => {
    setTab(tabForPath);
    // Only when the address changes - clicking a tab must not be undone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const pending = useApiResource(
    useCallback(
      () =>
        showManagerQueue
          ? leaveApi.pendingApprovals({ page_size: 1 })
          : Promise.resolve(EMPTY_PAGE),
      [showManagerQueue],
    ),
    [showManagerQueue, reloadKey],
  );
  const hrPending = useApiResource(
    useCallback(
      () =>
        mayApproveForHr ? leaveApi.hrApprovals({ page_size: 1 }) : Promise.resolve(EMPTY_PAGE),
      [mayApproveForHr],
    ),
    [mayApproveForHr, reloadKey],
  );

  const refreshAll = () => setReloadKey((key) => key + 1);

  return (
    <>
      <PageHeader
        title="Leave"
        subtitle="Balances, requests and approvals"
        actions={
          can('leave.apply') ? (
            <Button
              startIcon={<AddIcon />}
              variant="contained"
              onClick={() => setApplying(true)}
            >
              Apply for leave
            </Button>
          ) : undefined
        }
      />

      <Card>
        <Tabs
          value={tab}
          onChange={(_, next) => setTab(next)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab label="My balances" />
          <Tab label="My requests" />
          {showManagerQueue && (
            <Tab
              label={
                <QueueTabLabel
                  label="Manager approvals"
                  count={pending.data?.count ?? 0}
                  color="warning"
                />
              }
            />
          )}
          {mayApproveForHr && (
            <Tab
              label={
                <QueueTabLabel
                  label="HR approvals"
                  count={hrPending.data?.count ?? 0}
                  color="info"
                />
              }
            />
          )}
        </Tabs>

        {tab === 0 && (
          <LeaveBalancesTab reloadKey={reloadKey} onOpenRequests={() => setTab(1)} />
        )}
        {tab === 1 && <MyLeaveTab reloadKey={reloadKey} onChanged={refreshAll} />}
        {tab === MANAGER_TAB && (
          <LeaveApprovalsTab reloadKey={reloadKey} onChanged={refreshAll} stage="manager" />
        )}
        {tab === HR_TAB && (
          <LeaveApprovalsTab reloadKey={reloadKey} onChanged={refreshAll} stage="hr" />
        )}
      </Card>

      <ApplyLeaveDialog
        open={applying}
        onClose={() => setApplying(false)}
        onApplied={() => {
          setApplying(false);
          refreshAll();
          setTab(1);
        }}
      />
    </>
  );
}
