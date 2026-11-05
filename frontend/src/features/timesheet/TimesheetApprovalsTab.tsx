/**
 * Timesheet approval queue. Expanding a row shows the per-project breakdown,
 * so the reviewer can see what they are approving without leaving the page.
 *
 * Two stages share it: a manager's sheets are `pending`, and those the manager
 * has approved are `pending_hr`. Returning at the second stage goes back to the
 * manager rather than the employee, so it is called Send back.
 */

import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { Fragment, useCallback, useState } from 'react';

import { useAppDispatch } from '@/app/hooks';
import { EmptyState, ErrorAlert, TableSkeleton } from '@/components/common/Feedback';
import { showToast } from '@/features/ui/uiSlice';
import { useApiAction, useApiResource } from '@/hooks/useApiResource';
import { usePermissions } from '@/hooks/usePermissions';
import { timesheetsApi } from '@/services/api/services';
import type { Timesheet, TimesheetListItem } from '@/types/domain';
import ClosableDialogTitle from '@/components/common/ClosableDialogTitle';
import { formatDate, formatDateRange } from '@/utils/date';

type Decision = 'approve' | 'reject';

/**
 * Column widths shared by the requests table and the "What was done" table
 * that opens under a row. Both span the same width, so the same percentages
 * line up: Date under Employee, Project under Week, Hours under Hours, and the
 * task description across Submitted and Decision. Everything reads from the
 * left. Decision is as wide as its two buttons (Approve 97px + Return 86px)
 * and no wider, so there is no empty strip on the right; Employee (and Date
 * under it) takes the spare width.
 */
const COL = {
  expander: 56,
  week: '20%',
  hours: '12%',
  submitted: '14%',
  decision: 230,
} as const;

/**
 * The one set of column widths, given to both tables. A <colgroup> rather
 * than widths on header cells, because the inner table's task description
 * spans the Submitted and Decision columns - one cell cannot carry two widths.
 */
function Columns() {
  return (
    <colgroup>
      <col style={{ width: COL.expander }} />
      <col />
      <col style={{ width: COL.week }} />
      <col style={{ width: COL.hours }} />
      <col style={{ width: COL.submitted }} />
      <col style={{ width: COL.decision }} />
    </colgroup>
  );
}

/**
 * The "What was done" table's own columns. Sized so the space after each
 * column's text comes out about the same - Date ("31 Aug 2026"), Project
 * ("PRJ-001") and a typical one-line task description - with Task description
 * taking what is left. Hours is last and only as wide as its heading, so
 * nothing trails after it. Date still starts under Employee.
 */
const ENTRY_COL = { date: '28.3%', project: '29.5%', hours: 90 } as const;

/** The empty first column of the inner table, under the arrows. */
const INDENT_SX = { bgcolor: 'transparent', borderBottom: 0 } as const;

/** Left edge of the panel's text, level with the employee names. */
const TEXT_INDENT = `${COL.expander + 16}px`;

export default function TimesheetApprovalsTab({
  reloadKey,
  onChanged,
}: {
  reloadKey: number;
  onChanged: () => void;
}) {
  const dispatch = useAppDispatch();
  const { can } = usePermissions();
  const { data, loading, error, reload } = useApiResource(
    useCallback(() => timesheetsApi.pendingApprovals({ page_size: 50 }), []),
    [reloadKey],
  );

  const [expanded, setExpanded] = useState<number | null>(null);
  const [detail, setDetail] = useState<Timesheet | null>(null);
  const [dialog, setDialog] = useState<{ sheet: TimesheetListItem; decision: Decision } | null>(
    null,
  );
  const [comment, setComment] = useState('');

  const approve = useApiAction(timesheetsApi.approve);
  const reject = useApiAction(timesheetsApi.reject);
  const approveAll = useApiAction(timesheetsApi.hrApproveAll);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const busy = approve.busy || reject.busy || approveAll.busy;
  const actionError = approve.error ?? reject.error ?? approveAll.error;

  const dialogAtHr = dialog?.sheet.status === 'pending_hr';
  const returnLabel = dialogAtHr ? 'Send back' : 'Return';

  const handleApproveAll = async () => {
    const done = await approveAll.run();
    setConfirmingAll(false);
    if (done) {
      dispatch(showToast(`${done.approved} timesheets approved.`, 'success'));
      void reload();
      onChanged();
    }
  };

  const toggle = async (row: TimesheetListItem) => {
    if (expanded === row.id) {
      setExpanded(null);
      return;
    }
    setExpanded(row.id);
    setDetail(null);
    const full = await timesheetsApi.detail(row.id).catch(() => null);
    setDetail(full);
  };

  const submit = async () => {
    if (!dialog) return;
    if (dialog.decision === 'reject' && !comment.trim()) return;

    const updated =
      dialog.decision === 'approve'
        ? await approve.run(dialog.sheet.id, comment)
        : await reject.run(dialog.sheet.id, comment);

    if (updated) {
      dispatch(
        showToast(
          `${updated.employee_name}'s timesheet ${
            dialog.decision === 'approve'
              ? dialogAtHr
                ? 'approved'
                : 'approved and sent to HR'
              : dialogAtHr
                ? 'sent back to the manager'
                : 'returned'
          }.`,
          dialog.decision === 'approve' ? 'success' : 'info',
        ),
      );
      setDialog(null);
      setComment('');
      void reload();
      onChanged();
    }
  };

  // Grey placeholder rows while loading - the table's shape, not a full-width
  // blue bar under the tabs, which read as the tab underline gone wrong.
  if (loading) return <TableSkeleton rows={5} columns={5} />;
  if (error) return <ErrorAlert error={error} onRetry={reload} />;
  if (!data?.results.length) {
    return (
      <EmptyState
        title="Nothing waiting on you"
        detail="Submitted timesheets from your reporting branch appear here."
      />
    );
  }

  return (
    <>
      {actionError && <ErrorAlert error={actionError} />}
      {can('timesheet.hr_approve') &&
        data.results.some((row) => row.status === 'pending_hr') && (
          <Stack direction="row" justifyContent="flex-end" sx={{ p: 2 }}>
            <Button
              variant="contained"
              color="success"
              startIcon={<CheckIcon />}
              onClick={() => setConfirmingAll(true)}
              disabled={busy}
            >
              Approve all with HR
            </Button>
          </Stack>
        )}
      <TableContainer sx={{ overflowX: 'auto' }}>
        <Table size="small" sx={{ tableLayout: 'fixed', minWidth: 1000 }}>
          <Columns />
          <TableHead>
            <TableRow>
              <TableCell />
              <TableCell>Employee</TableCell>
              <TableCell>Week</TableCell>
              <TableCell>Hours</TableCell>
              <TableCell>Submitted</TableCell>
              <TableCell>Decision</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.results.map((row) => (
              <Fragment key={row.id}>
                <TableRow hover>
                  <TableCell>
                    <IconButton
                      size="small"
                      onClick={() => void toggle(row)}
                      aria-label="Show breakdown"
                    >
                      {expanded === row.id ? (
                        <KeyboardArrowUpIcon />
                      ) : (
                        <KeyboardArrowDownIcon />
                      )}
                    </IconButton>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>
                      {row.employee_name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {row.employee_code}
                      {row.department_name ? ` · ${row.department_name}` : ''}
                    </Typography>
                    {row.status === 'pending_hr' && (
                      <Typography variant="caption" color="success.dark" display="block">
                        Approved by manager
                      </Typography>
                    )}
                    {row.status === 'pending' && row.decision_comment && (
                      <Typography variant="caption" color="warning.dark" display="block">
                        Sent back by HR: {row.decision_comment}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {formatDateRange(row.week_start_date, row.week_end_date)}
                  </TableCell>
                  <TableCell>{row.total_hours}</TableCell>
                  <TableCell>
                    {row.submitted_at ? new Date(row.submitted_at).toLocaleDateString() : '-'}
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={1}>
                      <Button
                        size="small"
                        variant="contained"
                        color="success"
                        startIcon={<CheckIcon />}
                        onClick={() => {
                          setDialog({ sheet: row, decision: 'approve' });
                          setComment('');
                        }}
                        disabled={busy}
                      >
                        Approve
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        color="error"
                        startIcon={<CloseIcon />}
                        onClick={() => {
                          setDialog({ sheet: row, decision: 'reject' });
                          setComment('');
                        }}
                        disabled={busy}
                      >
                        {row.status === 'pending_hr' ? 'Send back' : 'Return'}
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell colSpan={6} sx={{ p: 0, borderBottom: 0 }}>
                    <Collapse in={expanded === row.id} unmountOnExit>
                      <Stack spacing={1} sx={{ py: 2 }}>
                        {!detail ? (
                          <LinearProgress sx={{ maxWidth: 240, ml: TEXT_INDENT }} />
                        ) : (
                          <>
                            <Typography variant="subtitle2" sx={{ pl: TEXT_INDENT }}>
                              Breakdown by project
                            </Typography>
                            {Object.entries(
                              detail.entries.reduce<Record<string, number>>((acc, entry) => {
                                const key = `${entry.project_code} — ${entry.project_name}`;
                                acc[key] = (acc[key] ?? 0) + Number(entry.hours);
                                return acc;
                              }, {}),
                            ).map(([project, hours]) => (
                              <Typography
                                key={project}
                                variant="body2"
                                sx={{ pl: TEXT_INDENT }}
                              >
                                {project}: <strong>{hours.toFixed(2)} h</strong>
                              </Typography>
                            ))}

                            <Typography variant="subtitle2" sx={{ pt: 1, pl: TEXT_INDENT }}>
                              What was done
                            </Typography>
                            <Table size="small" sx={{ tableLayout: 'fixed' }}>
                              <colgroup>
                                <col style={{ width: COL.expander }} />
                                <col style={{ width: ENTRY_COL.date }} />
                                <col style={{ width: ENTRY_COL.project }} />
                                <col />
                                <col style={{ width: ENTRY_COL.hours }} />
                              </colgroup>
                              <TableHead>
                                <TableRow>
                                  <TableCell sx={INDENT_SX} />
                                  <TableCell>Date</TableCell>
                                  <TableCell>Project</TableCell>
                                  <TableCell>Task description</TableCell>
                                  <TableCell>Hours</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {[...detail.entries]
                                  .sort((a, b) => a.work_date.localeCompare(b.work_date))
                                  .map((entry) => (
                                    <TableRow key={entry.id}>
                                      <TableCell sx={INDENT_SX} />
                                      {/* "31 Aug 2026", on one line - the raw
                                          2026-08-31 wrapped in its column. */}
                                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                        {formatDate(entry.work_date)}
                                      </TableCell>
                                      <TableCell>{entry.project_code}</TableCell>
                                      <TableCell>
                                        <Typography
                                          variant="body2"
                                          color={
                                            entry.description ? 'text.primary' : 'text.disabled'
                                          }
                                        >
                                          {entry.description || 'No description given'}
                                        </Typography>
                                      </TableCell>
                                      <TableCell>{Number(entry.hours).toFixed(2)}</TableCell>
                                    </TableRow>
                                  ))}
                              </TableBody>
                            </Table>

                            {detail.comments && (
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{ pl: TEXT_INDENT }}
                              >
                                Employee note: {detail.comments}
                              </Typography>
                            )}
                          </>
                        )}
                      </Stack>
                    </Collapse>
                  </TableCell>
                </TableRow>
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={Boolean(dialog)} onClose={() => setDialog(null)} fullWidth maxWidth="sm">
        <ClosableDialogTitle onClose={() => setDialog(null)}>
          {dialog?.decision === 'approve'
            ? 'Approve timesheet'
            : dialogAtHr
              ? 'Send back to the manager'
              : 'Return for correction'}
        </ClosableDialogTitle>
        <DialogContent>
          {dialog && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography variant="body2">
                {dialog.sheet.employee_name} · {dialog.sheet.total_hours} hours · week of{' '}
                {formatDate(dialog.sheet.week_start_date)}
              </Typography>
              <TextField
                label="Comment"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                multiline
                minRows={2}
                required={dialog.decision === 'reject'}
                error={dialog.decision === 'reject' && !comment.trim()}
                helperText={
                  dialog.decision === 'reject'
                    ? 'Required — explain what needs correcting.'
                    : 'Optional.'
                }
              />
              {dialog.decision === 'approve' && (
                <Typography variant="caption" color="text.secondary">
                  {dialogAtHr
                    ? 'Approved timesheets are locked and can no longer be edited by the employee.'
                    : 'It goes to HR for final approval.'}
                </Typography>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color={dialog?.decision === 'approve' ? 'success' : 'error'}
            onClick={submit}
            disabled={busy || (dialog?.decision === 'reject' && !comment.trim())}
          >
            {busy ? 'Saving...' : dialog?.decision === 'approve' ? 'Approve' : returnLabel}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={confirmingAll}
        onClose={() => setConfirmingAll(false)}
        fullWidth
        maxWidth="xs"
      >
        <ClosableDialogTitle onClose={() => setConfirmingAll(false)}>
          Approve all with HR
        </ClosableDialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Every timesheet waiting on HR is approved and locked, except any of your own.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmingAll(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="success"
            onClick={() => void handleApproveAll()}
            disabled={busy}
          >
            {approveAll.busy ? 'Approving...' : 'Approve all'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
