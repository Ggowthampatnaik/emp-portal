/** Timesheets: the weekly grid, my history, the approval queue and HR tracking. */

import Card from '@mui/material/Card';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import PageHeader from '@/components/common/PageHeader';
import QueueTabLabel from '@/components/common/QueueTabLabel';
import MyTimesheetsTab from '@/features/timesheet/MyTimesheetsTab';
import TimesheetApprovalsTab from '@/features/timesheet/TimesheetApprovalsTab';
import TimesheetTrackingTab from '@/features/timesheet/TimesheetTrackingTab';
import WeeklyGrid from '@/features/timesheet/WeeklyGrid';
import { usePermissions } from '@/hooks/usePermissions';
import { useApiResource } from '@/hooks/useApiResource';
import { timesheetsApi } from '@/services/api/services';

export default function TimesheetsPage() {
  const { can } = usePermissions();
  const mayApprove = can('timesheet.approve');
  // HR and above see every sheet, which is what the tracking board is built on.
  const mayTrack = can('timesheet.view_all');

  /**
   * `/timesheets/approvals` opens the caller's queue rather than this week's
   * grid. The route existed and the dashboard card and every timesheet
   * notification point at it, but the page ignored the path. A manager lands on
   * Requests; HR, who tracks rather than approves, lands on Submissions.
   */
  const { pathname } = useLocation();
  const queueTab = mayApprove ? 2 : mayTrack ? 2 : -1;
  const tabForPath = pathname.endsWith('/approvals') && queueTab >= 0 ? queueTab : 0;

  const [tab, setTab] = useState(tabForPath);
  const [reloadKey, setReloadKey] = useState(0);
  const refreshAll = () => setReloadKey((key) => key + 1);

  // Following a second link while already on the page has to move the tab too.
  useEffect(() => {
    setTab(tabForPath);
    // Only when the address changes - clicking a tab must not be undone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const pending = useApiResource(
    useCallback(
      () =>
        mayApprove
          ? timesheetsApi.pendingApprovals({ page_size: 1 })
          : Promise.resolve({ count: 0, results: [] } as never),
      [mayApprove],
    ),
    [mayApprove, reloadKey],
  );

  // One integer for the Submissions badge, not the whole board: HR needs to
  // see there is something outstanding without opening the tab to find out.
  const outstanding = useApiResource(
    useCallback(
      () =>
        mayTrack
          ? timesheetsApi.submissionCounts()
          : Promise.resolve({ pending_count: 0 } as never),
      [mayTrack],
    ),
    [mayTrack, reloadKey],
  );

  // Tabs are conditional, so their indices are derived rather than hard-coded.
  const REQUESTS = mayApprove ? 2 : -1;
  const TRACKING = mayTrack ? (mayApprove ? 3 : 2) : -1;

  return (
    <>
      <PageHeader title="Timesheets" subtitle="Book your week, submit it, track approvals" />

      <Card>
        <Tabs
          value={tab}
          onChange={(_, next) => setTab(next)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab label="This week" />
          <Tab label="My timesheets" />
          {mayApprove && (
            <Tab label={<QueueTabLabel label="Requests" count={pending.data?.count ?? 0} />} />
          )}
          {mayTrack && (
            <Tab
              label={
                <QueueTabLabel
                  label="Submissions"
                  count={outstanding.data?.pending_count ?? 0}
                  color="warning"
                />
              }
            />
          )}
        </Tabs>

        {tab === 0 && <WeeklyGrid onChanged={refreshAll} />}
        {tab === 1 && <MyTimesheetsTab reloadKey={reloadKey} />}
        {tab === REQUESTS && (
          <TimesheetApprovalsTab reloadKey={reloadKey} onChanged={refreshAll} />
        )}
        {tab === TRACKING && <TimesheetTrackingTab reloadKey={reloadKey} />}
      </Card>
    </>
  );
}
