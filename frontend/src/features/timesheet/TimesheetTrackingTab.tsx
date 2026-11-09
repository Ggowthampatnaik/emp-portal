/**
 * HR submission tracking: who has filed a timesheet for a given week.
 *
 * Two ways of looking at the same data — by project (the delivery view: is this
 * team's week accounted for?) and by employee (the compliance view: who is
 * behind?). Either way the action is the same: nudge whoever has not submitted.
 *
 * With no week sent the backend picks one: the last completed week, which is
 * what HR chases, or the current week as soon as anyone has submitted for it.
 * Navigating with the arrows is the only reason this component tracks a week.
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
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
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
import { EmptyState, ErrorAlert, TableSkeleton } from '@/components/common/Feedback';
import { showToast } from '@/features/ui/uiSlice';
import { usePermissions } from '@/hooks/usePermissions';
import { useApiAction, useApiResource } from '@/hooks/useApiResource';
import { timesheetsApi } from '@/services/api/services';
import { addDays, formatDateRange, fromIsoDate, mondayOf, toIsoDate } from '@/utils/date';
import TimesheetDetailsDialog from '@/features/timesheet/TimesheetDetailsDialog';
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

/** The small headings over a project's people, inside the project table. */
const SUBHEAD = { fontWeight: 600, color: 'text.secondary', fontSize: 13 } as const;

/**
 * One size for every Notify button in the Reminder column - "Notify" and
 * "Notify 12" alike - so the column reads as a column. Wide enough for a
 * two-digit count; the icon leads from the same left edge on every row.
 */
const NOTIFY_BUTTON_SX = { width: 120, justifyContent: 'flex-start', px: 1.5 } as const;

/** The Reminder column: one Notify button plus the cell's padding either side. */
const REMINDER_WIDTH = 120 + 2 * 16;

/** Notify, or "Not needed" once the timesheet is in. Same in every table. */
function ReminderCell({
  row,
  onNotify,
  mayNotify,
  sending,
  sent,
}: {
  row: SubmissionStatusRow;
  onNotify: (row: SubmissionStatusRow) => void;
  mayNotify: boolean;
  /** This row's reminder is on its way. */
  sending: boolean;
  /** Already reminded this week - the button stays off, so it is not sent twice. */
  sent: boolean;
}) {
  if (row.submitted) {
    return (
      <Typography variant="caption" color="text.disabled">
        Not needed
      </Typography>
    );
  }
  return (
    <Tooltip title={mayNotify ? 'Send a reminder' : 'You cannot send reminders'}>
      <span>
        <Button
          size="small"
          variant="outlined"
          startIcon={<NotificationsActiveIcon />}
          sx={NOTIFY_BUTTON_SX}
          onClick={() => onNotify(row)}
          disabled={!mayNotify || sending || sent}
        >
          {sent ? 'Sent' : 'Notify'}
        </Button>
      </span>
    </Tooltip>
  );
}

/** The rows-of-people table on the "Employee based" view. */
function EmployeeRows({
  rows,
  onNotify,
  mayNotify,
  sendingId,
  sentIds,
  onOpen,
  dense,
}: {
  rows: SubmissionStatusRow[];
  onNotify: (row: SubmissionStatusRow) => void;
  mayNotify: boolean;
  /** The employee whose reminder is on its way, if any. */
  sendingId: number | null;
  /** Employees already reminded this week. */
  sentIds: Set<number>;
  /** Opens this person's timesheet for the week. */
  onOpen: (row: SubmissionStatusRow) => void;
  dense?: boolean;
}) {
  return (
    // Fixed columns sharing the width evenly, all reading from the left.
    // Reminder is just wide enough for its button (no strip of empty space on
    // the right); Employee, the first column, takes what is left.
    <Table size="small" sx={{ tableLayout: 'fixed', minWidth: 1000 }}>
      <TableHead>
        <TableRow>
          <TableCell>Employee</TableCell>
          {!dense && <TableCell sx={{ width: '22%' }}>Department</TableCell>}
          <TableCell sx={{ width: '18%' }}>Status</TableCell>
          <TableCell sx={{ width: '14%' }}>Hours</TableCell>
          <TableCell sx={{ width: REMINDER_WIDTH }}>Reminder</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={row.employee_id}
            hover
            onClick={() => onOpen(row)}
            sx={{ cursor: 'pointer' }}
          >
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
            <TableCell>
              <HoursCell row={row} />
            </TableCell>
            {/* Reminding is not a request to open the timesheet. */}
            <TableCell onClick={(event) => event.stopPropagation()}>
              <ReminderCell
                row={row}
                onNotify={onNotify}
                mayNotify={mayNotify}
                sending={sendingId === row.employee_id}
                sent={sentIds.has(row.employee_id)}
              />
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
  // Null is the backend's choice; the week it chose comes back with the data.
  const [week, setWeek] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const toggleProject = (id: number) => setExpanded((open) => (open === id ? null : id));
  // Reminded this session; merged below with what the server remembers.
  const [sentHere, setSentHere] = useState<Set<number>>(new Set());
  // Which button is sending right now - only that one greys out while it does
  // ("p:<project>", "e:<employee>" or "all"). One shared busy flag used to
  // disable every Notify on the page.
  const [sending, setSending] = useState<string | null>(null);
  const [sentProjects, setSentProjects] = useState<Set<number>>(new Set());
  // The person whose timesheet is open in the details pop-up.
  const [viewing, setViewing] = useState<SubmissionStatusRow | null>(null);
  // A project's button is done once it was pressed, or once everyone it would
  // remind has been reminded one by one.
  const projectSent = (project: ProjectSubmissionRow) =>
    sentProjects.has(project.project_id) ||
    (project.pending_count > 0 &&
      project.employees
        .filter((row) => !row.submitted)
        .every((row) => nudged.has(row.employee_id)));

  const byProject = useApiResource(
    useCallback(() => timesheetsApi.statusByProject(week ?? undefined), [week]),
    [week, reloadKey],
  );
  const byEmployee = useApiResource(
    useCallback(() => timesheetsApi.statusByEmployee(week ?? undefined), [week]),
    [week, reloadKey],
  );

  // Everyone reminded about this week: what the server has on record - so a
  // reload keeps "Sent" - plus anything sent from this page since it loaded.
  const nudged = useMemo(() => {
    const ids = new Set(sentHere);
    for (const row of byEmployee.data?.results ?? []) {
      if (row.reminded_at) ids.add(row.employee_id);
    }
    for (const project of byProject.data?.results ?? []) {
      for (const row of project.employees) if (row.reminded_at) ids.add(row.employee_id);
    }
    return ids;
  }, [sentHere, byEmployee.data, byProject.data]);

  const notify = useApiAction(timesheetsApi.notify);
  const active = view === 0 ? byProject : byEmployee;
  const shownWeek = active.data?.week_start_date ?? week ?? lastCompletedWeek();

  const shiftWeek = (days: number) => {
    setWeek(toIsoDate(addDays(fromIsoDate(shownWeek), days)));
    setExpanded(null);
    setSentHere(new Set());
    setSentProjects(new Set());
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

  const notifyEmployees = async (rows: SubmissionStatusRow[], who: string, key: string) => {
    const pending = rows.filter((row) => !row.submitted);
    if (pending.length === 0) {
      announce(0, who);
      return;
    }
    setSending(key);
    const result = await notify
      .run({ employee_ids: pending.map((row) => row.employee_id), week: shownWeek })
      .finally(() => setSending(null));
    if (result) {
      announce(result.count, who);
      setSentHere((prev) => new Set([...prev, ...pending.map((row) => row.employee_id)]));
    }
  };

  const notifyProject = async (project: ProjectSubmissionRow) => {
    if (project.pending_count === 0) {
      announce(0, 'everyone on this project');
      return;
    }
    setSending(`p:${project.project_id}`);
    const result = await notify
      .run({ project: project.project_id, week: shownWeek })
      .finally(() => setSending(null));
    if (result) {
      announce(result.count, 'everyone on this project');
      setSentProjects((prev) => new Set([...prev, project.project_id]));
      setSentHere(
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
    : shownWeek;

  const weekCaption =
    shownWeek === toIsoDate(mondayOf(new Date()))
      ? 'This week'
      : shownWeek === lastCompletedWeek()
        ? 'Last completed week'
        : 'Selected week';

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
              {weekCaption}
            </Typography>
          </Box>
          <IconButton onClick={() => shiftWeek(7)} aria-label="Next week">
            <ChevronRightIcon />
          </IconButton>
          {week !== null && (
            <Button size="small" onClick={() => setWeek(null)}>
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
      {active.loading && <TableSkeleton rows={5} columns={5} />}

      {view === 0 &&
        !active.loading &&
        (byProject.data?.results.length === 0 ? (
          <EmptyState
            title="No open projects"
            detail="Projects appear here once they exist and have not been cancelled."
          />
        ) : (
          <TableContainer sx={{ overflowX: 'auto' }}>
            {/* Fixed columns, and a project's people drawn as rows of this same
                table rather than a table of their own: then Status sits under
                Manager, Hours under Submitted and each Notify under Reminder,
                whatever is open. A nested table sized its own columns and drifted. */}
            {/* Same idea as the employee table: shares of the width, Reminder
                sized to its button, Project taking what is left. */}
            <Table size="small" sx={{ tableLayout: 'fixed', minWidth: 1000 }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 56 }} />
                  <TableCell>Project</TableCell>
                  <TableCell sx={{ width: '22%' }}>Manager</TableCell>
                  <TableCell sx={{ width: '14%' }}>Team</TableCell>
                  <TableCell sx={{ width: '16%' }}>Submitted</TableCell>
                  <TableCell sx={{ width: REMINDER_WIDTH }}>Reminder</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(byProject.data?.results ?? []).map((project) => (
                  <Fragment key={project.project_id}>
                    {/* The whole row opens the project's team, not just the arrow. */}
                    <TableRow
                      hover
                      onClick={() => toggleProject(project.project_id)}
                      selected={expanded === project.project_id}
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell>
                        <IconButton
                          size="small"
                          onClick={(event) => {
                            // The row toggles too; once is enough.
                            event.stopPropagation();
                            toggleProject(project.project_id);
                          }}
                          aria-label={`Show the team on ${project.project_code}`}
                          aria-expanded={expanded === project.project_id}
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
                      <TableCell>{project.team_size}</TableCell>
                      <TableCell>
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
                      {/* Sending reminders is not a request to open the team. On the
                          cell, not the button, so a click on a greyed-out Notify
                          (which passes straight through it) does not open it either. */}
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<NotificationsActiveIcon />}
                          sx={NOTIFY_BUTTON_SX}
                          onClick={() => void notifyProject(project)}
                          disabled={
                            !mayNotify ||
                            project.pending_count === 0 ||
                            sending === `p:${project.project_id}` ||
                            projectSent(project)
                          }
                        >
                          {projectSent(project)
                            ? 'Sent'
                            : `Notify ${project.pending_count > 0 ? project.pending_count : ''}`}
                        </Button>
                      </TableCell>
                    </TableRow>
                    {expanded === project.project_id &&
                      (project.employees.length === 0 ? (
                        <TableRow>
                          <TableCell />
                          <TableCell colSpan={5}>
                            <Typography variant="body2" color="text.secondary">
                              Nobody is currently on this project.
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ) : (
                        <>
                          <TableRow sx={{ bgcolor: 'action.hover' }}>
                            <TableCell />
                            <TableCell sx={SUBHEAD}>Employee</TableCell>
                            <TableCell sx={SUBHEAD}>Status</TableCell>
                            <TableCell />
                            <TableCell sx={SUBHEAD}>Hours</TableCell>
                            <TableCell sx={SUBHEAD}>Reminder</TableCell>
                          </TableRow>
                          {project.employees.map((row) => (
                            <TableRow
                              key={row.employee_id}
                              hover
                              onClick={() => setViewing(row)}
                              sx={{ cursor: 'pointer' }}
                            >
                              <TableCell />
                              <TableCell>
                                <Typography variant="body2" fontWeight={600}>
                                  {row.employee_name}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {row.employee_code}
                                  {row.department_name ? ' · ' + row.department_name : ''}
                                </Typography>
                              </TableCell>
                              <TableCell>
                                <SubmissionChip row={row} />
                              </TableCell>
                              <TableCell />
                              <TableCell>
                                <HoursCell row={row} />
                              </TableCell>
                              <TableCell onClick={(event) => event.stopPropagation()}>
                                <ReminderCell
                                  row={row}
                                  onNotify={(person) =>
                                    void notifyEmployees(
                                      [person],
                                      person.employee_name,
                                      `e:${person.employee_id}`,
                                    )
                                  }
                                  mayNotify={mayNotify}
                                  sending={sending === `e:${row.employee_id}`}
                                  sent={nudged.has(row.employee_id)}
                                />
                              </TableCell>
                            </TableRow>
                          ))}
                        </>
                      ))}
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
                  filteredEmployees.filter((row) => !nudged.has(row.employee_id)),
                  search ? 'everyone matching this search' : 'everyone',
                  'all',
                )
              }
              disabled={
                !mayNotify ||
                sending === 'all' ||
                pendingInView.every((row) => nudged.has(row.employee_id))
              }
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
                onNotify={(row) =>
                  void notifyEmployees([row], row.employee_name, `e:${row.employee_id}`)
                }
                mayNotify={mayNotify}
                sendingId={sending?.startsWith('e:') ? Number(sending.slice(2)) : null}
                sentIds={nudged}
                onOpen={setViewing}
              />
            </TableContainer>
          )}
        </>
      )}

      {nudged.size > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
          {nudged.size} reminder{nudged.size === 1 ? '' : 's'} sent for this week.
        </Typography>
      )}

      {viewing && (
        <TimesheetDetailsDialog
          key={viewing.employee_id}
          row={viewing}
          weekStart={shownWeek}
          weekEnd={toIsoDate(addDays(fromIsoDate(shownWeek), 6))}
          onClose={() => setViewing(null)}
        />
      )}
    </Box>
  );
}
