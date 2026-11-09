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
import { ROLES } from '@/types/auth';

export default function TimesheetsPage() {
  const { can, roles, isSuperAdmin } = usePermissions();
  // Managers approve first and HR second; the queue shows each their own stage.
  const mayApprove = can('timesheet.approve') || can('timesheet.hr_approve');
  // The Submissions board is HR's: chasing people who have not filed. Admin can
  // read every sheet too (it backs their timesheet reports) but chases nobody,
  // so the tab is not theirs - unless they also hold HR. Super Admin keeps it.
  const adminOnly = roles.includes(ROLES.ADMIN) && !roles.includes(ROLES.HR) && !isSuperAdmin;
  const mayTrack = can('timesheet.view_all') && !adminOnly;

  /**
   * `/timesheets/approvals` opens the caller's queue rather than this week's
   * grid. The route existed and the dashboard card and every timesheet
   * notification point at it, but the page ignored the path. It lands on
   * Requests for anyone who approves, and on Submissions for anyone who only tracks.
   */
  const { pathname } = useLocation();
  const queueTab = mayApprove ? 2 : mayTrack ? 2 : -1;
  const tabForPath = pathname.endsWith('/approvals') && queueTab >= 0 ? queueTab : 0;

  const [tab, setTab] = useState(tabForPath);
  // A week picked from My timesheets, opened in the editor on the first tab.
  const [openWeek, setOpenWeek] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const refreshAll = useCallback(() => setReloadKey((key) => key + 1), []);

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

  // Coming back to the board is when somebody expects it to have moved on: they
  // have usually just been in another tab watching a timesheet go in.
  useEffect(() => {
    if (tab !== TRACKING) return;
    window.addEventListener('focus', refreshAll);
    return () => window.removeEventListener('focus', refreshAll);
  }, [tab, TRACKING, refreshAll]);

  return (
    <>
      <PageHeader title="Timesheets" subtitle="Book your week, submit it, track approvals" />

      <Card>
        <Tabs
          value={tab}
          onChange={(_, next) => {
            setOpenWeek(null); // the tab itself always opens on the current week
            setTab(next);
          }}
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

        {tab === 0 && (
          <WeeklyGrid
            key={openWeek ?? 'current'}
            initialWeek={openWeek}
            onChanged={refreshAll}
          />
        )}
        {tab === 1 && (
          <MyTimesheetsTab
            reloadKey={reloadKey}
            onOpen={(weekStart) => {
              setOpenWeek(weekStart);
              setTab(0);
            }}
          />
        )}
        {tab === REQUESTS && (
          <TimesheetApprovalsTab reloadKey={reloadKey} onChanged={refreshAll} />
        )}
        {tab === TRACKING && <TimesheetTrackingTab reloadKey={reloadKey} />}
      </Card>
    </>
  );
}
