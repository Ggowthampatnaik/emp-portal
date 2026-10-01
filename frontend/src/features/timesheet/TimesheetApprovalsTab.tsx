/**
 * Timesheet approval queue. Expanding a row shows the per-project breakdown,
 * so the reviewer can see what they are approving without leaving the page.
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
import { EmptyState, ErrorAlert } from '@/components/common/Feedback';
import { showToast } from '@/features/ui/uiSlice';
import { useApiAction, useApiResource } from '@/hooks/useApiResource';
import { timesheetsApi } from '@/services/api/services';
import type { Timesheet, TimesheetListItem } from '@/types/domain';
import ClosableDialogTitle from '@/components/common/ClosableDialogTitle';
import { formatDate, formatDateRange } from '@/utils/date';

type Decision = 'approve' | 'reject';

export default function TimesheetApprovalsTab({
  reloadKey,
  onChanged,
}: {
  reloadKey: number;
  onChanged: () => void;
}) {
  const dispatch = useAppDispatch();
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
  const busy = approve.busy || reject.busy;
  const actionError = approve.error ?? reject.error;

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
            dialog.decision === 'approve' ? 'approved' : 'returned'
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

  if (loading) return <LinearProgress />;
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
      <TableContainer sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell width={48} />
              <TableCell>Employee</TableCell>
              <TableCell>Week</TableCell>
              <TableCell align="right">Hours</TableCell>
              <TableCell>Submitted</TableCell>
              <TableCell align="right">Decision</TableCell>
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
                  </TableCell>
                  <TableCell>
                    {formatDateRange(row.week_start_date, row.week_end_date)}
                  </TableCell>
                  <TableCell align="right">{row.total_hours}</TableCell>
                  <TableCell>
                    {row.submitted_at ? new Date(row.submitted_at).toLocaleDateString() : '-'}
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={1} justifyContent="flex-end">
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
                        Return
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell colSpan={6} sx={{ py: 0, borderBottom: 0 }}>
                    <Collapse in={expanded === row.id} unmountOnExit>
                      <Stack spacing={1} sx={{ py: 2, pl: 6 }}>
                        {!detail ? (
                          <LinearProgress sx={{ maxWidth: 240 }} />
                        ) : (
                          <>
                            <Typography variant="subtitle2">Breakdown by project</Typography>
                            {Object.entries(
                              detail.entries.reduce<Record<string, number>>((acc, entry) => {
                                const key = `${entry.project_code} — ${entry.project_name}`;
                                acc[key] = (acc[key] ?? 0) + Number(entry.hours);
                                return acc;
                              }, {}),
                            ).map(([project, hours]) => (
                              <Typography key={project} variant="body2">
                                {project}: <strong>{hours.toFixed(2)} h</strong>
                              </Typography>
                            ))}

                            <Typography variant="subtitle2" sx={{ pt: 1 }}>
                              What was done
                            </Typography>
                            <Table size="small">
                              <TableHead>
                                <TableRow>
                                  <TableCell width={110}>Date</TableCell>
                                  <TableCell width={120}>Project</TableCell>
                                  <TableCell width={70} align="right">
                                    Hours
                                  </TableCell>
                                  <TableCell>Task description</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {[...detail.entries]
                                  .sort((a, b) => a.work_date.localeCompare(b.work_date))
                                  .map((entry) => (
                                    <TableRow key={entry.id}>
                                      <TableCell>{entry.work_date}</TableCell>
                                      <TableCell>{entry.project_code}</TableCell>
                                      <TableCell align="right">
                                        {Number(entry.hours).toFixed(2)}
                                      </TableCell>
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
                                    </TableRow>
                                  ))}
                              </TableBody>
                            </Table>

                            {detail.comments && (
                              <Typography variant="caption" color="text.secondary">
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
          {dialog?.decision === 'approve' ? 'Approve timesheet' : 'Return for correction'}
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
                  Approved timesheets are locked and can no longer be edited by the employee.
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
            {busy ? 'Saving...' : dialog?.decision === 'approve' ? 'Approve' : 'Return'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
