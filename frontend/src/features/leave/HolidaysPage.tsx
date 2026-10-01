/**
 * The holiday calendar for a whole year, grouped month by month.
 *
 * Open to everyone — this is where "View More" on the dashboard card lands.
 * HR additionally gets the add, edit and remove controls and the Word-document
 * import, so there is one place that holds holidays rather than a read-only
 * page and a separate admin tab.
 */

import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import CelebrationIcon from '@mui/icons-material/Celebration';
import ViewListIcon from '@mui/icons-material/ViewList';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import { useCallback, useMemo, useState } from 'react';

import { useAppDispatch } from '@/app/hooks';
import ClosableDialogTitle from '@/components/common/ClosableDialogTitle';
import { CardGridSkeleton, ErrorAlert } from '@/components/common/Feedback';
import PageHeader from '@/components/common/PageHeader';
import { showToast } from '@/features/ui/uiSlice';
import { usePermissions } from '@/hooks/usePermissions';
import { useApiAction, useApiResource } from '@/hooks/useApiResource';
import HolidayCalendar from '@/features/leave/HolidayCalendar';
import { leaveApi } from '@/services/api/services';
import { CARD_SHADOW } from '@/styles/theme';
import { daysBetween, formatDate, fromIsoDate, todayIso } from '@/utils/date';
import type { Holiday, HolidayImportSummary } from '@/types/domain';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const YEARS = [-1, 0, 1].map((offset) => new Date().getFullYear() + offset);

/**
 * Rows a month shows before it offers the rest. Two keeps every card the same
 * short height, so a year reads as a grid of months rather than a ragged
 * column - and December with one holiday sits level with January with four.
 */
const ROWS_SHOWN = 2;

/** "Today", "Tomorrow", "in N days" or "Passed" - the birthday page's voice. */
function whenLabel(daysUntil: number): string {
  if (daysUntil === 0) return 'Today';
  if (daysUntil === 1) return 'Tomorrow';
  if (daysUntil < 0) return 'Passed';
  return `in ${daysUntil} days`;
}

/** One swatch in the calendar's legend, drawn the way the day cells are. */
function LegendKey({
  label,
  variant,
}: {
  label: string;
  variant: 'filled' | 'outlined' | 'today';
}) {
  return (
    <Stack direction="row" spacing={0.75} alignItems="center">
      <Box
        aria-hidden
        sx={(theme) => ({
          width: 18,
          height: 18,
          borderRadius: '50%',
          ...(variant === 'filled' && { bgcolor: theme.palette.primary.main }),
          ...(variant === 'outlined' && {
            border: `1.5px solid ${theme.palette.primary.main}`,
          }),
          ...(variant === 'today' && {
            outline: `2px solid ${theme.palette.secondary.main}`,
            outlineOffset: 1,
          }),
        })}
      />
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Stack>
  );
}

/**
 * One holiday, laid out like a birthday row: a round badge, the name with its
 * detail beneath, and the date with a "when" chip on the right. The two pages
 * show the same kind of thing - a dated entry in a month - so they read the
 * same way.
 */
function HolidayRow({
  holiday,
  daysUntil,
  onEdit,
  onRemove,
}: {
  holiday: Holiday;
  /** Negative once it has passed, 0 today. */
  daysUntil: number;
  onEdit?: () => void;
  onRemove?: () => void;
}) {
  const day = Number(holiday.date.slice(8, 10));
  const month = MONTHS[Number(holiday.date.slice(5, 7)) - 1]?.slice(0, 3);
  const isToday = daysUntil === 0;
  const isPast = daysUntil < 0;

  return (
    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ py: 1.25 }}>
      <Avatar
        sx={{
          width: 40,
          height: 40,
          flexShrink: 0,
          fontSize: 15,
          fontWeight: 700,
          bgcolor: isToday ? 'secondary.main' : isPast ? 'action.hover' : 'primary.light',
          color: isPast ? 'text.disabled' : undefined,
        }}
      >
        {day}
      </Avatar>

      <Box sx={{ minWidth: 0, flexGrow: 1, opacity: isPast ? 0.65 : 1 }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          {/* Wrapped rather than clipped: a person's name fits a line, but
              "Makar Sankranti / Pongal" does not, and "Makar Sankranti / ..."
              tells the reader less than the second line costs. */}
          <Typography
            variant="body2"
            fontWeight={600}
            title={holiday.name}
            sx={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {holiday.name}
          </Typography>
          {holiday.is_optional && <Chip size="small" variant="outlined" label="Optional" />}
        </Stack>
        {/* Two lines rather than an ellipsis, the same as a birthday row: the
            day of the week and what the day is for are both worth reading. */}
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {holiday.day_of_week}
          {holiday.description ? ` · ${holiday.description}` : ''}
        </Typography>
      </Box>

      <Stack alignItems="flex-end" spacing={0.5} sx={{ flexShrink: 0 }}>
        <Typography
          variant="caption"
          fontWeight={700}
          color={isPast ? 'text.disabled' : undefined}
        >
          {day} {month}
        </Typography>
        <Chip
          size="small"
          label={whenLabel(daysUntil)}
          color={isToday ? 'secondary' : 'default'}
          variant={isToday ? 'filled' : 'outlined'}
        />
      </Stack>

      {(onEdit || onRemove) && (
        <Stack direction="row" sx={{ flexShrink: 0 }}>
          {onEdit && (
            <IconButton size="small" aria-label={`Edit ${holiday.name}`} onClick={onEdit}>
              <EditIcon fontSize="small" />
            </IconButton>
          )}
          {onRemove && (
            <IconButton size="small" aria-label={`Remove ${holiday.name}`} onClick={onRemove}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          )}
        </Stack>
      )}
    </Stack>
  );
}

export default function HolidaysPage() {
  const dispatch = useAppDispatch();
  const { can } = usePermissions();
  const mayManage = can('leave.manage_policy');

  const [year, setYear] = useState(new Date().getFullYear());
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  /**
   * The month grid first: a holiday calendar is a thing people look at rather
   * than read down, and the current month with its closures marked answers
   * "when is the next one" at a glance. The list is a click away for the
   * detail - descriptions, and HR's edit and remove controls.
   */
  const [view, setView] = useState<'list' | 'calendar'>('calendar');
  /** The month the calendar view is showing. Opens on the current one. */
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth());
  /** Set while the dialog is editing an existing holiday rather than adding. */
  const [editing, setEditing] = useState<Holiday | null>(null);
  const [form, setForm] = useState({
    date: todayIso(),
    name: '',
    description: '',
    is_optional: 'false',
  });

  const { data, loading, error, reload } = useApiResource(
    useCallback(() => leaveApi.holidays(year), [year]),
    [year],
  );
  const create = useApiAction(leaveApi.createHoliday);
  const update = useApiAction((body: Partial<Holiday>) =>
    leaveApi.updateHoliday(editing!.id, body),
  );
  const remove = useApiAction(leaveApi.deleteHoliday);
  /** The action whose errors the dialog is currently showing. */
  const save = editing ? update : create;

  const openAdd = () => {
    setEditing(null);
    setForm({ date: todayIso(), name: '', description: '', is_optional: 'false' });
    setOpen(true);
  };

  const openEdit = (holiday: Holiday) => {
    setEditing(holiday);
    setForm({
      date: holiday.date,
      name: holiday.name,
      description: holiday.description,
      is_optional: String(holiday.is_optional),
    });
    setOpen(true);
  };

  /** Holidays bucketed into the twelve months, in date order. */
  const byMonth = useMemo(() => {
    const buckets: Holiday[][] = Array.from({ length: 12 }, () => []);
    for (const holiday of data?.results ?? []) {
      const month = fromIsoDate(holiday.date).getMonth();
      buckets[month]?.push(holiday);
    }
    for (const bucket of buckets) bucket.sort((a, b) => a.date.localeCompare(b.date));
    return buckets;
  }, [data]);

  const today = todayIso();
  const currentMonth = new Date().getMonth();
  const isCurrentYear = year === new Date().getFullYear();

  /** Months the reader has opened up. Collapses again when the year changes. */
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const toggleMonth = (index: number) =>
    setExpanded((open) => {
      const next = new Set(open);
      if (!next.delete(index)) next.add(index);
      return next;
    });

  const handleSave = async () => {
    const payload = {
      date: form.date,
      name: form.name,
      description: form.description,
      is_optional: form.is_optional === 'true',
    };
    const saved = editing ? await update.run(payload) : await create.run(payload);
    if (saved) {
      dispatch(
        showToast(
          editing ? `${saved.name} updated.` : `${saved.name} added to the calendar.`,
          'success',
        ),
      );
      setOpen(false);
      setEditing(null);
      void reload();
    }
  };

  return (
    <>
      <PageHeader
        title="Holidays"
        subtitle={`${data?.count ?? 0} company holiday${data?.count === 1 ? '' : 's'} in ${year}`}
        actions={
          <Stack direction="row" spacing={1}>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={view}
              onChange={(_, next) => next && setView(next)}
              aria-label="How to show the year"
            >
              <ToggleButton value="list" aria-label="List">
                <ViewListIcon fontSize="small" sx={{ mr: 0.5 }} />
                List
              </ToggleButton>
              <ToggleButton value="calendar" aria-label="Calendar">
                <CalendarMonthIcon fontSize="small" sx={{ mr: 0.5 }} />
                Calendar
              </ToggleButton>
            </ToggleButtonGroup>
            <TextField
              select
              label="Year"
              size="small"
              value={year}
              onChange={(event) => {
                setYear(Number(event.target.value));
                setExpanded(new Set());
              }}
              sx={{ minWidth: 120 }}
            >
              {YEARS.map((option) => (
                <MenuItem key={option} value={option}>
                  {option}
                </MenuItem>
              ))}
            </TextField>
            {mayManage && (
              <>
                <Button startIcon={<UploadFileIcon />} onClick={() => setImportOpen(true)}>
                  Import from Word
                </Button>
                <Button startIcon={<AddIcon />} variant="contained" onClick={openAdd}>
                  Add holiday
                </Button>
              </>
            )}
          </Stack>
        }
      />

      {error && <ErrorAlert error={error} onRetry={reload} />}
      {(create.error || remove.error) && <ErrorAlert error={(create.error ?? remove.error)!} />}
      {loading && !data && <CardGridSkeleton cards={6} height={190} />}
      {loading && data && <LinearProgress sx={{ mb: 2 }} />}

      {view === 'calendar' ? (
        <HolidayCalendar
          year={year}
          month={calendarMonth}
          onMonthChange={setCalendarMonth}
          holidays={data?.results ?? []}
          todayIso={today}
          onSelect={mayManage ? openEdit : undefined}
        />
      ) : (
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' },
            // One height for every month, the same as the Birthdays page. `1fr`
            // rows take the tallest card's height and each card fills its cell,
            // so a quiet month sits level with a busy one. Opening a month grows
            // its row rather than leaving the grid ragged.
            gridAutoRows: '1fr',
          }}
        >
          {MONTHS.map((month, index) => {
            const holidays = byMonth[index] ?? [];
            const isCurrent = isCurrentYear && index === currentMonth;
            const isOpen = expanded.has(index);
            const hidden = Math.max(0, holidays.length - ROWS_SHOWN);
            const shown = isOpen ? holidays : holidays.slice(0, ROWS_SHOWN);

            return (
              <Card
                key={month}
                // Lifts under the pointer, the same 160ms rise the dashboard
                // cards use, so a month reads as one object and the eye keeps
                // its place while scanning twelve of them. The current month
                // keeps its full-strength border on hover: it already carries
                // the emphasis, and fading it to the hover wash would be a step
                // backwards.
                sx={(theme) => ({
                  borderColor: isCurrent ? 'primary.main' : undefined,
                  borderWidth: isCurrent ? 2 : 1,
                  transition:
                    'box-shadow 160ms ease, transform 160ms ease, border-color 160ms ease',
                  '&:hover': {
                    boxShadow: CARD_SHADOW[theme.palette.mode].hover,
                    transform: 'translateY(-2px)',
                    borderColor: isCurrent
                      ? 'primary.main'
                      : alpha(theme.palette.primary.main, 0.45),
                  },
                })}
              >
                <CardContent>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                    <CelebrationIcon
                      fontSize="small"
                      color={holidays.length ? 'primary' : 'disabled'}
                    />
                    <Typography variant="subtitle2" fontWeight={700}>
                      {month}
                    </Typography>
                    {isCurrent && <Chip size="small" color="primary" label="This month" />}
                    <Box sx={{ flexGrow: 1 }} />
                    <Typography variant="caption" color="text.secondary">
                      {holidays.length || 'none'}
                    </Typography>
                  </Stack>

                  {holidays.length === 0 ? (
                    <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                      No holidays in {month}.
                    </Typography>
                  ) : (
                    <>
                      <Stack divider={<Divider flexItem />}>
                        {shown.map((holiday) => (
                          <HolidayRow
                            key={holiday.id}
                            holiday={holiday}
                            daysUntil={daysBetween(today, holiday.date)}
                            onEdit={mayManage ? () => openEdit(holiday) : undefined}
                            onRemove={
                              mayManage
                                ? async () => {
                                    await remove.run(holiday.id);
                                    void reload();
                                  }
                                : undefined
                            }
                          />
                        ))}
                      </Stack>

                      {/* Only when there is something behind it: a card with two
                          holidays should not offer to show you nothing. */}
                      {hidden > 0 && (
                        <Button
                          size="small"
                          fullWidth
                          onClick={() => toggleMonth(index)}
                          sx={{ mt: 1, textTransform: 'none' }}
                        >
                          {isOpen ? 'Show less' : `View ${hidden} more`}
                        </Button>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </Box>
      )}

      {/* Three marks, none of them obvious on sight. */}
      {view === 'calendar' && (
        <Stack
          direction="row"
          spacing={2.5}
          flexWrap="wrap"
          useFlexGap
          sx={{ mt: 2, alignItems: 'center' }}
        >
          <LegendKey label="Office closed" variant="filled" />
          <LegendKey label="Optional holiday" variant="outlined" />
          <LegendKey label="Today" variant="today" />
          {mayManage && (
            <Typography variant="caption" color="text.secondary">
              Select a marked day to edit it.
            </Typography>
          )}
        </Stack>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <ClosableDialogTitle onClose={() => setOpen(false)}>
          {editing ? `Edit ${editing.name}` : 'Add holiday'}
        </ClosableDialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="Date"
              type="date"
              value={form.date}
              onChange={(event) => setForm({ ...form, date: event.target.value })}
              slotProps={{ inputLabel: { shrink: true } }}
              error={Boolean(save.fieldErrors.date)}
              helperText={save.fieldErrors.date ?? ' '}
              required
            />
            <TextField
              label="Name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              error={Boolean(save.fieldErrors.name)}
              helperText={save.fieldErrors.name ?? ' '}
              required
            />
            <TextField
              label="Description"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              multiline
              minRows={2}
              required
              error={Boolean(save.fieldErrors.description)}
              helperText={
                save.fieldErrors.description ??
                'Shown to employees wherever this holiday appears.'
              }
            />
            <TextField
              select
              label="Type"
              value={form.is_optional}
              onChange={(event) => setForm({ ...form, is_optional: event.target.value })}
              helperText="Optional holidays still consume leave when taken."
            >
              <MenuItem value="false">Mandatory</MenuItem>
              <MenuItem value="true">Optional / floating</MenuItem>
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={save.busy || !form.date || !form.name || !form.description.trim()}
          >
            {save.busy ? 'Saving...' : editing ? 'Save changes' : 'Add'}
          </Button>
        </DialogActions>
      </Dialog>

      <ImportHolidaysDialog
        open={importOpen}
        year={year}
        onClose={() => setImportOpen(false)}
        onImported={(summary) => {
          dispatch(
            showToast(
              `Imported: ${summary.created} added, ${summary.updated} updated.`,
              'success',
            ),
          );
          void reload();
        }}
      />
    </>
  );
}

/**
 * "Import from Word": HR uploads the .docx holiday circular and the calendar
 * fills itself in - a table or a plain list, either shape. The result stays on
 * screen until it is read: which holidays landed, and which lines could not be
 * understood, because a silent partial import is how a holiday goes missing
 * until somebody books leave over it.
 */
function ImportHolidaysDialog({
  open,
  year,
  onClose,
  onImported,
}: {
  open: boolean;
  year: number;
  onClose: () => void;
  onImported: (summary: HolidayImportSummary) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [importYear, setImportYear] = useState(year);
  const [summary, setSummary] = useState<HolidayImportSummary | null>(null);
  const importAction = useApiAction((f: File) => leaveApi.importHolidaysDocx(f, importYear));

  const reset = () => {
    setFile(null);
    setSummary(null);
    onClose();
  };

  const handleImport = async () => {
    if (!file) return;
    const result = await importAction.run(file);
    if (result) {
      setSummary(result);
      onImported(result);
    }
  };

  return (
    <Dialog open={open} onClose={reset} fullWidth maxWidth="sm">
      <ClosableDialogTitle onClose={reset}>Import holidays from Word</ClosableDialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Upload the holiday circular as a .docx. A table (date, name, notes) or a plain list
            (&ldquo;14 January &mdash; Makar Sankranti&rdquo;) both work. Existing holidays on
            the same date are updated; nothing is ever deleted by an import.
          </Typography>

          <Stack direction="row" spacing={2} alignItems="center">
            <Button component="label" variant="outlined" startIcon={<UploadFileIcon />}>
              {file ? 'Change file' : 'Choose .docx'}
              <input
                hidden
                type="file"
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setSummary(null);
                }}
              />
            </Button>
            <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
              {file?.name ?? 'No file chosen'}
            </Typography>
          </Stack>

          <TextField
            select
            label="Year for dates without one"
            size="small"
            value={importYear}
            onChange={(event) => setImportYear(Number(event.target.value))}
            helperText='A circular often says just "14 January" - this fills in the year.'
            sx={{ maxWidth: 280 }}
          >
            {YEARS.map((option) => (
              <MenuItem key={option} value={option}>
                {option}
              </MenuItem>
            ))}
          </TextField>

          {importAction.error && <ErrorAlert error={importAction.error} />}

          {summary && (
            <Box>
              <Typography variant="subtitle2">
                {summary.created} added · {summary.updated} updated · {summary.unchanged}{' '}
                already current
              </Typography>
              {summary.holidays.length > 0 && (
                <Stack component="ul" sx={{ pl: 2.5, my: 1, gap: 0.25 }}>
                  {summary.holidays.map((row) => (
                    <Typography key={row.date} component="li" variant="body2">
                      {formatDate(row.date)} — {row.name}
                      {row.is_optional ? ' (optional)' : ''}
                    </Typography>
                  ))}
                </Stack>
              )}
              {summary.skipped_count > 0 && (
                <Typography variant="body2" color="warning.main">
                  {summary.skipped_count} line{summary.skipped_count === 1 ? '' : 's'} could not
                  be read: {summary.skipped.join(' · ')}
                </Typography>
              )}
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={reset}>{summary ? 'Done' : 'Cancel'}</Button>
        {!summary && (
          <Button
            variant="contained"
            onClick={handleImport}
            disabled={!file || importAction.busy}
          >
            {importAction.busy ? 'Importing...' : 'Import'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
