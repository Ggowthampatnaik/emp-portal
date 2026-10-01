/**
 * HR submission tracking: who has filed a timesheet for a given week.
 *
 * Two ways of looking at the same data — by project (the delivery view: is this
 * team's week accounted for?) and by employee (the compliance view: who is
 * behind?). Either way the action is the same: nudge whoever has not submitted.
 *
 * The week defaults to the last completed one, which is what HR chases; the
 * backend applies the same default when no week is sent, so navigating with the
 * arrows is the only reason this component tracks a week at all.
 */

import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import SearchIcon from '@mui/icons-material/Search';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { Fragment, useCallback, useMemo, useState } from 'react';

import { useAppDispatch } from '@/app/hooks';
import { EmptyState, ErrorAlert } from '@/components/common/Feedback';
import { showToast } from '@/features/ui/uiSlice';
import { usePermissions } from '@/hooks/usePermissions';
import { useApiAction, useApiResource } from '@/hooks/useApiResource';
import { timesheetsApi } from '@/services/api/services';
import { addDays, formatDateRange, fromIsoDate, mondayOf, toIsoDate } from '@/utils/date';
import type { ProjectSubmissionRow, SubmissionStatusRow } from '@/types/domain';

/** The Monday of the week that finished before today — what HR chases. */
function lastCompletedWeek(): string {
  return toIsoDate(addDays(mondayOf(new Date()), -7));
}

/** Submitted / awaiting / nothing filed at all, as one pill. */
function SubmissionChip({ row }: { row: SubmissionStatusRow }) {
  if (row.status === 'approved') {
    return <Chip size="small" color="success" label="Approved" />;
  }
  if (row.submitted) {
    return <Chip size="small" color="info" label="Submitted" />;
  }
  return (
    <Chip
      size="small"
      color="warning"
      variant="outlined"
      label={row.status === 'draft' ? 'Draft only' : 'Not submitted'}
    />
  );
}

function HoursCell({ row }: { row: SubmissionStatusRow }) {
  return (
    <Typography variant="body2" color={row.total_hours ? 'text.primary' : 'text.disabled'}>
      {row.total_hours ? `${Number(row.total_hours).toFixed(2)} h` : '—'}
    </Typography>
  );
}

/** The shared rows-of-people table, used inside a project and on its own. */
function EmployeeRows({
  rows,
  onNotify,
  mayNotify,
  busy,
  dense,
}: {
  rows: SubmissionStatusRow[];
  onNotify: (row: SubmissionStatusRow) => void;
  mayNotify: boolean;
  busy: boolean;
  dense?: boolean;
}) {
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>Employee</TableCell>
          {!dense && <TableCell>Department</TableCell>}
          <TableCell>Status</TableCell>
          <TableCell align="right">Hours</TableCell>
          <TableCell align="right">Reminder</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.employee_id} hover>
            <TableCell>
              <Typography variant="body2" fontWeight={600}>
                {row.employee_name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {row.employee_code}
                {dense && row.department_name ? ` · ${row.department_name}` : ''}
                {!dense && row.designation_name ? ` · ${row.designation_name}` : ''}
              </Typography>
            </TableCell>
            {!dense && (
              <TableCell>
                <Typography variant="body2">{row.department_name ?? '—'}</Typography>
              </TableCell>
            )}
            <TableCell>
              <SubmissionChip row={row} />
            </TableCell>
            <TableCell align="right">
              <HoursCell row={row} />
            </TableCell>
            <TableCell align="right">
              {row.submitted ? (
                <Typography variant="caption" color="text.disabled">
                  Not needed
                </Typography>
              ) : (
                <Tooltip title={mayNotify ? 'Send a reminder' : 'You cannot send reminders'}>
                  <span>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<NotificationsActiveIcon />}
                      onClick={() => onNotify(row)}
                      disabled={!mayNotify || busy}
                    >
                      Notify
                    </Button>
                  </span>
                </Tooltip>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function TimesheetTrackingTab({ reloadKey }: { reloadKey: number }) {
  const dispatch = useAppDispatch();
  const { can } = usePermissions();
  const mayNotify = can('timesheet.notify');

  const [view, setView] = useState(0);
  const [week, setWeek] = useState(lastCompletedWeek);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [nudged, setNudged] = useState<Set<number>>(new Set());

  const byProject = useApiResource(
    useCallback(() => timesheetsApi.statusByProject(week), [week]),
    [week, reloadKey],
  );
  const byEmployee = useApiResource(
    useCallback(() => timesheetsApi.statusByEmployee(week), [week]),
    [week, reloadKey],
  );

  const notify = useApiAction(timesheetsApi.notify);
  const active = view === 0 ? byProject : byEmployee;

  const shiftWeek = (days: number) => {
    setWeek((current) => toIsoDate(addDays(fromIsoDate(current), days)));
    setExpanded(null);
    setNudged(new Set());
  };

  const announce = (count: number, who: string) => {
    dispatch(
      showToast(
        count === 0
          ? `Nobody to remind — ${who} already submitted.`
          : `Reminder sent to ${count} ${count === 1 ? 'person' : 'people'}.`,
        count === 0 ? 'info' : 'success',
      ),
    );
  };

  const notifyEmployees = async (rows: SubmissionStatusRow[], who: string) => {
    const pending = rows.filter((row) => !row.submitted);
    if (pending.length === 0) {
      announce(0, who);
      return;
    }
    const result = await notify.run({
      employee_ids: pending.map((row) => row.employee_id),
      week,
    });
    if (result) {
      announce(result.count, who);
      setNudged((prev) => new Set([...prev, ...pending.map((row) => row.employee_id)]));
    }
  };

  const notifyProject = async (project: ProjectSubmissionRow) => {
    if (project.pending_count === 0) {
      announce(0, 'everyone on this project');
      return;
    }
    const result = await notify.run({ project: project.project_id, week });
    if (result) {
      announce(result.count, 'everyone on this project');
      setNudged(
        (prev) =>
          new Set([
            ...prev,
            ...project.employees.filter((row) => !row.submitted).map((row) => row.employee_id),
          ]),
      );
    }
  };

  /** Employee view is long, so it gets a search box. */
  const filteredEmployees = useMemo(() => {
    const rows = byEmployee.data?.results ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.employee_name, row.employee_code, row.department_name, row.designation_name]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(needle)),
    );
  }, [byEmployee.data, search]);

  const pendingInView = filteredEmployees.filter((row) => !row.submitted);

  const weekLabel = active.data
    ? formatDateRange(active.data.week_start_date, active.data.week_end_date)
    : week;

  return (
    <Box sx={{ p: 2 }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        alignItems={{ xs: 'stretch', md: 'center' }}
        justifyContent="space-between"
        sx={{ mb: 2 }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <IconButton onClick={() => shiftWeek(-7)} aria-label="Previous week">
            <ChevronLeftIcon />
          </IconButton>
          <Box sx={{ minWidth: 230, textAlign: 'center' }}>
            <Typography variant="h4">{weekLabel}</Typography>
            <Typography variant="caption" color="text.secondary">
              {week === lastCompletedWeek() ? 'Last completed week' : 'Selected week'}
            </Typography>
          </Box>
          <IconButton onClick={() => shiftWeek(7)} aria-label="Next week">
            <ChevronRightIcon />
          </IconButton>
          {week !== lastCompletedWeek() && (
            <Button size="small" onClick={() => setWeek(lastCompletedWeek())}>
              Latest
            </Button>
          )}
        </Stack>

        {byEmployee.data && (
          <Stack direction="row" spacing={1}>
            <Chip
              size="small"
              color="success"
              label={`${byEmployee.data.submitted_count} submitted`}
            />
            <Chip
              size="small"
              color="warning"
              variant="outlined"
              label={`${byEmployee.data.pending_count} outstanding`}
            />
          </Stack>
        )}
      </Stack>

      <Tabs
        value={view}
        onChange={(_, next) => setView(next)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ mb: 1 }}
      >
        <Tab label="Project based" />
        <Tab label="Employee based" />
      </Tabs>
      <Divider sx={{ mb: 2 }} />

      {notify.error && <ErrorAlert error={notify.error} />}
      {active.error && <ErrorAlert error={active.error} onRetry={active.reload} />}
      {active.loading && <LinearProgress sx={{ mb: 2 }} />}

      {view === 0 &&
        !active.loading &&
        (byProject.data?.results.length === 0 ? (
          <EmptyState
            title="No open projects"
            detail="Projects appear here once they exist and have not been cancelled."
          />
        ) : (
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell width={48} />
                  <TableCell>Project</TableCell>
                  <TableCell>Manager</TableCell>
                  <TableCell align="center">Team</TableCell>
                  <TableCell align="center">Submitted</TableCell>
                  <TableCell align="right">Reminder</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(byProject.data?.results ?? []).map((project) => (
                  <Fragment key={project.project_id}>
                    <TableRow hover>
                      <TableCell>
                        <IconButton
                          size="small"
                          onClick={() =>
                            setExpanded(
                              expanded === project.project_id ? null : project.project_id,
                            )
                          }
                          aria-label={`Show the team on ${project.project_code}`}
                        >
                          {expanded === project.project_id ? (
                            <KeyboardArrowUpIcon />
                          ) : (
                            <KeyboardArrowDownIcon />
                          )}
                        </IconButton>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" fontWeight={600}>
                          {project.project_code}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {project.project_name}
                          {project.client_name ? ` · ${project.client_name}` : ''}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {project.project_manager_name ?? '—'}
                        </Typography>
                      </TableCell>
                      <TableCell align="center">{project.team_size}</TableCell>
                      <TableCell align="center">
                        <Chip
                          size="small"
                          color={
                            project.team_size === 0
                              ? 'default'
                              : project.pending_count === 0
                                ? 'success'
                                : 'warning'
                          }
                          variant={project.pending_count === 0 ? 'filled' : 'outlined'}
                          label={`${project.submitted_count}/${project.team_size}`}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<NotificationsActiveIcon />}
                          onClick={() => void notifyProject(project)}
                          disabled={!mayNotify || notify.busy || project.pending_count === 0}
                        >
                          Notify {project.pending_count > 0 ? project.pending_count : ''}
                        </Button>
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={6} sx={{ py: 0, borderBottom: 0 }}>
                        <Collapse in={expanded === project.project_id} unmountOnExit>
                          <Box sx={{ py: 2, pl: 4 }}>
                            {project.employees.length === 0 ? (
                              <Typography variant="body2" color="text.secondary">
                                Nobody is currently on this project.
                              </Typography>
                            ) : (
                              <EmployeeRows
                                rows={project.employees}
                                onNotify={(row) =>
                                  void notifyEmployees([row], row.employee_name)
                                }
                                mayNotify={mayNotify}
                                busy={notify.busy}
                                dense
                              />
                            )}
                          </Box>
                        </Collapse>
                      </TableCell>
                    </TableRow>
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        ))}

      {view === 1 && !active.loading && (
        <>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            sx={{ mb: 2 }}
            alignItems={{ xs: 'stretch', sm: 'center' }}
          >
            <TextField
              size="small"
              placeholder="Search by name, code or department"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                },
              }}
              sx={{ flexGrow: 1, maxWidth: { sm: 380 } }}
            />
            <Button
              variant="contained"
              startIcon={<NotificationsActiveIcon />}
              onClick={() =>
                void notifyEmployees(
                  filteredEmployees,
                  search ? 'everyone matching this search' : 'everyone',
                )
              }
              disabled={!mayNotify || notify.busy || pendingInView.length === 0}
            >
              Notify all outstanding ({pendingInView.length})
            </Button>
          </Stack>

          {filteredEmployees.length === 0 ? (
            <EmptyState
              title="Nobody matches"
              detail={
                search
                  ? 'No employee matches that search for this week.'
                  : 'There are no active employees to track.'
              }
            />
          ) : (
            <TableContainer sx={{ overflowX: 'auto' }}>
              <EmployeeRows
                rows={filteredEmployees}
                onNotify={(row) => void notifyEmployees([row], row.employee_name)}
                mayNotify={mayNotify}
                busy={notify.busy}
              />
            </TableContainer>
          )}
        </>
      )}

      {nudged.size > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
          {nudged.size} reminder{nudged.size === 1 ? '' : 's'} sent for this week. Sending again
          creates another notification.
        </Typography>
      )}
    </Box>
  );
}
