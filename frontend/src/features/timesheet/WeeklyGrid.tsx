/**
 * The weekly timesheet grid.
 *
 * Rows are the projects the employee is allocated to, columns are Mon-Sun.
 * The whole week is saved in one PUT (the backend replaces the entries), which
 * keeps deletion, edit and add as the same operation.
 *
 * Every booked cell also carries a task description. Seven text boxes per row
 * will not fit, so the description lives behind a note icon that opens a
 * popover for that one day; the icon is filled once something is written.
 */

import NoteAddOutlinedIcon from '@mui/icons-material/NoteAddOutlined';
import SaveIcon from '@mui/icons-material/Save';
import SendIcon from '@mui/icons-material/Send';
import StickyNote2Icon from '@mui/icons-material/StickyNote2';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import IconButton from '@mui/material/IconButton';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import LinearProgress from '@mui/material/LinearProgress';
import Popover from '@mui/material/Popover';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useAppDispatch } from '@/app/hooks';
import { EmptyState, ErrorAlert } from '@/components/common/Feedback';
import StatusChip from '@/components/common/StatusChip';
import { showToast } from '@/features/ui/uiSlice';
import { useApiAction, useApiResource } from '@/hooks/useApiResource';
import { projectsApi, timesheetsApi } from '@/services/api/services';
import {
  addDays,
  formatDateRange,
  formatDateShort,
  mondayOf,
  toIsoDate,
  toIsoDate as isoDate,
} from '@/utils/date';
import type { TimesheetEntryPayload } from '@/types/domain';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const DESCRIPTION_MAX = 500;

/** Grid state: `${projectId}|${isoDate}` -> the value as typed. */
type CellMap = Record<string, string>;

/** Which note popover is open, and where it hangs. */
type OpenNote = {
  key: string;
  anchor: HTMLElement;
  projectCode: string;
  day: string;
};

export default function WeeklyGrid({ onChanged }: { onChanged: () => void }) {
  const dispatch = useAppDispatch();
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [cells, setCells] = useState<CellMap>({});
  const [notes, setNotes] = useState<CellMap>({});
  const [dirty, setDirty] = useState(false);
  const [openNote, setOpenNote] = useState<OpenNote | null>(null);

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart],
  );

  /**
   * Hours are a report of work done, so a day that has not happened has
   * nothing to report. The server refuses a future date outright; the grid
   * greys those cells so nobody types into one and finds out on save, and the
   * week arrow stops at the week containing today.
   */
  const today = toIsoDate(new Date());
  const isFuture = (day: Date) => isoDate(day) > today;
  const atCurrentWeek = isoDate(mondayOf(new Date())) === isoDate(weekStart);

  const timesheet = useApiResource(
    useCallback(() => timesheetsApi.weekly(isoDate(weekStart)), [weekStart]),
    [weekStart],
  );
  const allocations = useApiResource(
    useCallback(() => projectsApi.myAllocations(), []),
    [],
  );

  const save = useApiAction(timesheetsApi.saveEntries);
  const submit = useApiAction(timesheetsApi.submit);

  // Load the sheet's entries into the grid whenever the week changes.
  useEffect(() => {
    if (!timesheet.data) return;
    const nextCells: CellMap = {};
    const nextNotes: CellMap = {};
    for (const entry of timesheet.data.entries) {
      const key = `${entry.project}|${entry.work_date}`;
      nextCells[key] = String(Number(entry.hours));
      nextNotes[key] = entry.description ?? '';
    }
    setCells(nextCells);
    setNotes(nextNotes);
    setDirty(false);
    setOpenNote(null);
  }, [timesheet.data]);

  const projects = useMemo(() => {
    const fromAllocations = (allocations.data?.results ?? []).map((allocation) => ({
      id: allocation.project,
      code: allocation.project_code,
      name: allocation.project_name,
    }));
    // Keep any project already booked on this sheet, even if the allocation ended.
    for (const entry of timesheet.data?.entries ?? []) {
      if (!fromAllocations.some((project) => project.id === entry.project)) {
        fromAllocations.push({
          id: entry.project,
          code: entry.project_code,
          name: entry.project_name,
        });
      }
    }
    return fromAllocations;
  }, [allocations.data, timesheet.data]);

  const sheet = timesheet.data;
  const editable = sheet?.is_editable ?? false;

  const setCell = (projectId: number, day: string, value: string) => {
    setCells((prev) => ({ ...prev, [`${projectId}|${day}`]: value }));
    setDirty(true);
  };

  const setNote = (key: string, value: string) => {
    setNotes((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const dayTotal = (day: string) =>
    projects.reduce((sum, project) => sum + (Number(cells[`${project.id}|${day}`]) || 0), 0);

  const projectTotal = (projectId: number) =>
    weekDays.reduce(
      (sum, day) => sum + (Number(cells[`${projectId}|${isoDate(day)}`]) || 0),
      0,
    );

  const weekTotal = projects.reduce((sum, project) => sum + projectTotal(project.id), 0);
  const overloadedDays = weekDays.filter((day) => dayTotal(isoDate(day)) > 24);

  /** Booked cells with nothing written in them — the backend refuses these on submit. */
  const undescribed = useMemo(() => {
    const missing: { projectCode: string; day: string }[] = [];
    for (const project of projects) {
      for (const day of weekDays) {
        const key = `${project.id}|${isoDate(day)}`;
        if (Number(cells[key]) > 0 && !(notes[key] ?? '').trim()) {
          missing.push({ projectCode: project.code, day: isoDate(day) });
        }
      }
    }
    return missing;
  }, [projects, weekDays, cells, notes]);

  const buildPayload = (): TimesheetEntryPayload[] => {
    const rows: TimesheetEntryPayload[] = [];
    for (const project of projects) {
      for (const day of weekDays) {
        // A future day is never sent. Its cell is disabled, so this only bites
        // on a sheet that already carried one - and the server would refuse it
        // anyway, leaving the reader with an error about a box they cannot
        // reach.
        if (isFuture(day)) continue;
        const key = `${project.id}|${isoDate(day)}`;
        const raw = cells[key];
        const hours = Number(raw);
        if (raw && hours > 0) {
          rows.push({
            project: project.id,
            work_date: isoDate(day),
            hours: hours.toFixed(2),
            description: (notes[key] ?? '').trim(),
          });
        }
      }
    }
    return rows;
  };

  const handleSave = async () => {
    if (!sheet) return;
    const updated = await save.run(sheet.id, buildPayload());
    if (updated) {
      timesheet.setData(updated);
      setDirty(false);
      dispatch(showToast(`Saved ${updated.total_hours} hours.`, 'success'));
      onChanged();
    }
  };

  const handleSubmit = async () => {
    if (!sheet) return;
    // Save first so what is submitted is what is on screen.
    const saved = dirty ? await save.run(sheet.id, buildPayload()) : sheet;
    if (!saved) return;

    const submitted = await submit.run(saved.id, '');
    if (submitted) {
      timesheet.setData(submitted);
      setDirty(false);
      dispatch(showToast('Timesheet submitted for approval.', 'success'));
      onChanged();
    }
  };

  if (timesheet.loading) return <LinearProgress />;
  if (timesheet.error) return <ErrorAlert error={timesheet.error} onRetry={timesheet.reload} />;
  if (!sheet) return null;

  const openNoteValue = openNote ? (notes[openNote.key] ?? '') : '';

  return (
    <Box sx={{ p: 2 }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', md: 'center' }}
        spacing={2}
        sx={{ mb: 2 }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <IconButton
            onClick={() => setWeekStart(addDays(weekStart, -7))}
            aria-label="Previous week"
          >
            <ChevronLeftIcon />
          </IconButton>
          <Box sx={{ minWidth: 220, textAlign: 'center' }}>
            <Typography variant="h4">
              {formatDateRange(sheet.week_start_date, sheet.week_end_date)}
            </Typography>
            <Stack direction="row" spacing={1} justifyContent="center" sx={{ mt: 0.5 }}>
              <StatusChip status={sheet.status} />
              <Typography variant="caption" color="text.secondary">
                {weekTotal.toFixed(2)} h
              </Typography>
            </Stack>
          </Box>
          <IconButton
            onClick={() => setWeekStart(addDays(weekStart, 7))}
            aria-label="Next week"
            disabled={atCurrentWeek}
            title={atCurrentWeek ? 'Next week has not happened yet.' : undefined}
          >
            <ChevronRightIcon />
          </IconButton>
          <Button size="small" onClick={() => setWeekStart(mondayOf(new Date()))}>
            This week
          </Button>
        </Stack>

        <Stack direction="row" spacing={1}>
          <Button
            startIcon={<SaveIcon />}
            variant="outlined"
            onClick={handleSave}
            disabled={!editable || save.busy || !dirty}
          >
            {save.busy ? 'Saving...' : 'Save draft'}
          </Button>
          <Button
            startIcon={<SendIcon />}
            variant="contained"
            onClick={handleSubmit}
            disabled={
              !editable ||
              submit.busy ||
              weekTotal === 0 ||
              overloadedDays.length > 0 ||
              undescribed.length > 0
            }
          >
            {submit.busy ? 'Submitting...' : 'Submit for approval'}
          </Button>
        </Stack>
      </Stack>

      {save.error && <ErrorAlert error={save.error} />}
      {submit.error && <ErrorAlert error={submit.error} />}

      {!editable && (
        <Alert severity={sheet.status === 'approved' ? 'success' : 'info'} sx={{ mb: 2 }}>
          {sheet.status === 'approved'
            ? `Approved by ${sheet.decided_by_name ?? 'your manager'}. Approved timesheets are locked.`
            : 'Submitted and awaiting approval. It becomes editable again only if it is returned to you.'}
          {sheet.decision_comment ? ` — ${sheet.decision_comment}` : ''}
        </Alert>
      )}

      {sheet.status === 'rejected' && sheet.decision_comment && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Returned for correction: {sheet.decision_comment}
        </Alert>
      )}

      {overloadedDays.length > 0 && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {overloadedDays.map((day) => isoDate(day)).join(', ')} exceed 24 hours. Reduce the
          hours before submitting.
        </Alert>
      )}

      {editable && undescribed.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {undescribed.length === 1
            ? 'One booked day has no task description'
            : `${undescribed.length} booked days have no task description`}{' '}
          —{' '}
          {undescribed
            .slice(0, 4)
            .map((cell) => `${cell.projectCode} on ${cell.day}`)
            .join(', ')}
          {undescribed.length > 4 ? ', …' : ''}. Use the note icon on each cell to say what you
          worked on; it is required before submitting.
        </Alert>
      )}

      {projects.length === 0 ? (
        <EmptyState
          title="No projects allocated to you"
          detail="Hours can only be booked to a project you are allocated to. Ask your manager for an allocation."
        />
      ) : (
        <Card variant="outlined">
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ minWidth: 200 }}>Project</TableCell>
                  {weekDays.map((day, index) => (
                    <TableCell key={isoDate(day)} align="center" sx={{ minWidth: 104 }}>
                      <Typography variant="caption" display="block" fontWeight={700}>
                        {DAY_LABELS[index]}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formatDateShort(toIsoDate(day))}
                      </Typography>
                    </TableCell>
                  ))}
                  <TableCell align="right">Total</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {projects.map((project) => (
                  <TableRow key={project.id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>
                        {project.code}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {project.name}
                      </Typography>
                    </TableCell>
                    {weekDays.map((day) => {
                      const key = `${project.id}|${isoDate(day)}`;
                      const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                      const booked = Number(cells[key]) > 0;
                      const note = (notes[key] ?? '').trim();
                      return (
                        <TableCell key={key} align="center" sx={{ p: 0.5 }}>
                          <Stack direction="row" spacing={0.25} alignItems="center">
                            <TextField
                              value={cells[key] ?? ''}
                              onChange={(event) =>
                                setCell(project.id, isoDate(day), event.target.value)
                              }
                              disabled={!editable || isFuture(day)}
                              size="small"
                              type="number"
                              title={
                                isFuture(day) ? 'This day has not happened yet.' : undefined
                              }
                              slotProps={{ htmlInput: { min: 0, max: 24, step: 0.5 } }}
                              sx={{
                                width: 68,
                                bgcolor: isWeekend ? 'action.hover' : undefined,
                                '& input': { textAlign: 'center', px: 0.5 },
                              }}
                            />
                            <Box sx={{ width: 28, flexShrink: 0 }}>
                              {booked && (
                                <Tooltip title={note || 'Add a task description'}>
                                  <IconButton
                                    size="small"
                                    color={note ? 'primary' : 'default'}
                                    aria-label={`Task description for ${project.code} on ${isoDate(day)}`}
                                    onClick={(event) =>
                                      setOpenNote({
                                        key,
                                        anchor: event.currentTarget,
                                        projectCode: project.code,
                                        day: isoDate(day),
                                      })
                                    }
                                    sx={{ p: 0.25 }}
                                  >
                                    {note ? (
                                      <StickyNote2Icon fontSize="small" />
                                    ) : (
                                      <NoteAddOutlinedIcon
                                        fontSize="small"
                                        color={editable ? 'warning' : 'disabled'}
                                      />
                                    )}
                                  </IconButton>
                                </Tooltip>
                              )}
                            </Box>
                          </Stack>
                        </TableCell>
                      );
                    })}
                    <TableCell align="right">
                      <strong>{projectTotal(project.id).toFixed(2)}</strong>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell>
                    <strong>Daily total</strong>
                  </TableCell>
                  {weekDays.map((day) => {
                    const total = dayTotal(isoDate(day));
                    return (
                      <TableCell
                        key={`total-${isoDate(day)}`}
                        align="center"
                        sx={{ color: total > 24 ? 'error.main' : undefined }}
                      >
                        <strong>{total ? total.toFixed(2) : '-'}</strong>
                      </TableCell>
                    );
                  })}
                  <TableCell align="right">
                    <strong>{weekTotal.toFixed(2)}</strong>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      )}

      <Popover
        open={Boolean(openNote)}
        anchorEl={openNote?.anchor ?? null}
        onClose={() => setOpenNote(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        transformOrigin={{ vertical: 'top', horizontal: 'center' }}
        slotProps={{ paper: { sx: { p: 2, width: 340 } } }}
      >
        {openNote && (
          <Stack spacing={1.5}>
            <Box>
              <Typography variant="subtitle2">What did you work on?</Typography>
              <Typography variant="caption" color="text.secondary">
                {openNote.projectCode} · {openNote.day}
              </Typography>
            </Box>
            <TextField
              autoFocus
              multiline
              minRows={3}
              size="small"
              placeholder="e.g. Fixed the checkout retry bug and reviewed two PRs"
              value={openNoteValue}
              onChange={(event) => setNote(openNote.key, event.target.value)}
              disabled={!editable}
              slotProps={{
                htmlInput: { maxLength: DESCRIPTION_MAX, 'aria-label': 'Task description' },
              }}
              helperText={`${openNoteValue.length}/${DESCRIPTION_MAX}`}
            />
            <Stack direction="row" justifyContent="flex-end">
              <Button size="small" onClick={() => setOpenNote(null)}>
                Done
              </Button>
            </Stack>
          </Stack>
        )}
      </Popover>

      {dirty && editable && (
        <Typography variant="caption" color="warning.main" sx={{ mt: 1, display: 'block' }}>
          Unsaved changes.
        </Typography>
      )}
    </Box>
  );
}
