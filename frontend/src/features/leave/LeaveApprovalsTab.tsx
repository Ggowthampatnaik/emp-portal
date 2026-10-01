/**
 * An approval queue. The same table serves both stages of the workflow:
 *
 * - **manager** — the caller's reporting branch, never their own request.
 *   Approve hands it to HR; Reject stops it here (that is the only stage where
 *   rejection exists, per decision D2).
 * - **hr** — what the managers have already approved. Approve is what actually
 *   debits the balance (D1); disagreement is a *send back*, not a rejection, so
 *   the request keeps moving instead of dead-ending.
 *
 * Every row carries the applicant's remaining balance, because approving
 * without it is how a balance goes negative.
 */

import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import ReplyIcon from '@mui/icons-material/Reply';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import LinearProgress from '@mui/material/LinearProgress';
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
import { useCallback, useState } from 'react';

import { useAppDispatch } from '@/app/hooks';
import { EmptyState, ErrorAlert } from '@/components/common/Feedback';
import { showToast } from '@/features/ui/uiSlice';
import { useApiAction, useApiResource } from '@/hooks/useApiResource';
import { leaveApi } from '@/services/api/services';
import type { LeaveQueueRow } from '@/types/domain';
import ClosableDialogTitle from '@/components/common/ClosableDialogTitle';
import { formatDate } from '@/utils/date';

type Stage = 'manager' | 'hr';
type Decision = 'approve' | 'reject' | 'send_back';

const COPY: Record<Decision, { title: string; verb: string; past: string }> = {
  approve: { title: 'Approve leave', verb: 'Approve', past: 'approved' },
  reject: { title: 'Reject leave', verb: 'Reject', past: 'rejected' },
  send_back: {
    title: 'Send back to the manager',
    verb: 'Send back',
    past: 'sent back to the manager',
  },
};

/** How much of the entitlement is left, and whether this request fits in it. */
function BalanceCell({ row }: { row: LeaveQueueRow }) {
  if (row.available_days === null) {
    return (
      <Typography variant="caption" color="text.disabled">
        —
      </Typography>
    );
  }

  const available = Number(row.available_days);
  const requested = Number(row.total_days);
  // The days are already reserved, so `available` has them taken out; a
  // request that no longer fits means something else was approved meanwhile.
  const short = available < 0;

  return (
    <Tooltip
      title={`${row.entitled_days} entitled · ${row.used_days} used · ${requested} in this request`}
    >
      <Chip
        size="small"
        color={short ? 'error' : 'default'}
        variant="outlined"
        label={`${row.available_days} left`}
      />
    </Tooltip>
  );
}

export default function LeaveApprovalsTab({
  reloadKey,
  onChanged,
  stage = 'manager',
}: {
  reloadKey: number;
  onChanged: () => void;
  stage?: Stage;
}) {
  const dispatch = useAppDispatch();
  const { data, loading, error, reload } = useApiResource(
    useCallback(
      () =>
        stage === 'hr'
          ? leaveApi.hrApprovals({ page_size: 50 })
          : leaveApi.pendingApprovals({ page_size: 50 }),
      [stage],
    ),
    [reloadKey, stage],
  );

  const [dialog, setDialog] = useState<{ request: LeaveQueueRow; decision: Decision } | null>(
    null,
  );
  const [comment, setComment] = useState('');

  const approve = useApiAction(leaveApi.approve);
  const reject = useApiAction(leaveApi.reject);
  const sendBack = useApiAction(leaveApi.sendBack);
  const busy = approve.busy || reject.busy || sendBack.busy;
  const actionError = approve.error ?? reject.error ?? sendBack.error;

  const open = (request: LeaveQueueRow, decision: Decision) => {
    setDialog({ request, decision });
    setComment('');
  };

  const submit = async () => {
    if (!dialog) return;
    const { decision, request } = dialog;
    if (decision === 'send_back' && comment.trim().length < 5) return;

    const run =
      decision === 'approve' ? approve.run : decision === 'reject' ? reject.run : sendBack.run;

    const updated = await run(request.id, comment);
    if (updated) {
      dispatch(
        showToast(
          `${updated.employee_name}'s leave ${
            decision === 'approve' && stage === 'manager'
              ? 'approved and sent to HR'
              : COPY[decision].past
          }.`,
          decision === 'approve' ? 'success' : 'info',
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
        detail={
          stage === 'hr'
            ? 'Requests appear here once the reporting manager has approved them.'
            : 'Leave requests from your reporting branch appear here as soon as they are submitted.'
        }
      />
    );
  }

  const sendBackTooShort = dialog?.decision === 'send_back' && comment.trim().length < 5;

  return (
    <>
      {actionError && <ErrorAlert error={actionError} />}

      {stage === 'hr' && (
        <Alert severity="info" sx={{ m: 2 }}>
          These have been approved by the reporting manager. Approving here confirms the leave
          and deducts it from the balance; if something is wrong, send it back to the manager
          rather than rejecting it.
        </Alert>
      )}

      <TableContainer sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Employee</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>From</TableCell>
              <TableCell>To</TableCell>
              <TableCell align="right">Days</TableCell>
              <TableCell align="center">Balance</TableCell>
              {stage === 'hr' && <TableCell>Manager</TableCell>}
              <TableCell>Reason</TableCell>
              <TableCell align="right">Decision</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.results.map((row) => (
              <TableRow key={row.id} hover>
                <TableCell>
                  <Typography variant="body2" fontWeight={600}>
                    {row.employee_name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {row.employee_code}
                    {row.department_name ? ` · ${row.department_name}` : ''}
                  </Typography>
                </TableCell>
                <TableCell>{row.leave_type_name}</TableCell>
                <TableCell>{formatDate(row.start_date)}</TableCell>
                <TableCell>{formatDate(row.end_date)}</TableCell>
                <TableCell align="right">{row.total_days}</TableCell>
                <TableCell align="center">
                  <BalanceCell row={row} />
                </TableCell>
                {stage === 'hr' && (
                  <TableCell>
                    <Typography variant="body2">
                      {row.manager_decided_by_name ?? '—'}
                    </Typography>
                    {row.manager_comment && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        noWrap
                        display="block"
                        title={row.manager_comment}
                        sx={{ maxWidth: 160 }}
                      >
                        {row.manager_comment}
                      </Typography>
                    )}
                  </TableCell>
                )}
                <TableCell sx={{ maxWidth: 240 }}>
                  <Typography variant="body2" noWrap title={row.reason}>
                    {row.reason}
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={1} justifyContent="flex-end">
                    <Button
                      size="small"
                      variant="contained"
                      color="success"
                      startIcon={<CheckIcon />}
                      onClick={() => open(row, 'approve')}
                      disabled={busy}
                    >
                      Approve
                    </Button>
                    {stage === 'manager' ? (
                      <Button
                        size="small"
                        variant="outlined"
                        color="error"
                        startIcon={<CloseIcon />}
                        onClick={() => open(row, 'reject')}
                        disabled={busy}
                      >
                        Reject
                      </Button>
                    ) : (
                      // A filled blue button, named for where the request
                      // goes: distinct from Approve's green without reading
                      // as a refusal the way red would.
                      <Button
                        size="small"
                        variant="contained"
                        color="primary"
                        startIcon={<ReplyIcon />}
                        onClick={() => open(row, 'send_back')}
                        disabled={busy}
                      >
                        Send Back To Manager
                      </Button>
                    )}
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={Boolean(dialog)} onClose={() => setDialog(null)} fullWidth maxWidth="sm">
        <ClosableDialogTitle onClose={() => setDialog(null)}>
          {dialog ? COPY[dialog.decision].title : ''}
        </ClosableDialogTitle>
        <DialogContent>
          {dialog && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography variant="body2">
                {dialog.request.employee_name} · {dialog.request.leave_type_name} ·{' '}
                {dialog.request.total_days} day(s) from {dialog.request.start_date} to{' '}
                {dialog.request.end_date}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {dialog.request.reason}
              </Typography>

              <TextField
                label="Comment"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                multiline
                minRows={2}
                required={dialog.decision === 'send_back'}
                error={Boolean(comment) && sendBackTooShort}
                helperText={
                  dialog.decision === 'send_back'
                    ? 'Required — the manager has to act on this, so say what to look at.'
                    : dialog.decision === 'reject'
                      ? 'Explain what needs to change; the employee sees this.'
                      : 'Optional.'
                }
              />

              {dialog.decision === 'approve' && (
                <Alert severity={stage === 'hr' ? 'warning' : 'info'}>
                  {stage === 'hr'
                    ? `Confirms the leave and deducts ${dialog.request.total_days} day(s) from the balance.`
                    : 'Passes the request to HR, who confirm it. Nothing is deducted yet.'}
                </Alert>
              )}
              {dialog.decision === 'send_back' && (
                <Alert severity="info">
                  The request goes back to{' '}
                  {dialog.request.manager_decided_by_name ?? 'the manager'} for another look.
                  The days stay reserved in the meantime.
                </Alert>
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
            color={
              dialog?.decision === 'approve'
                ? 'success'
                : dialog?.decision === 'reject'
                  ? 'error'
                  : 'warning'
            }
            onClick={submit}
            disabled={busy || sendBackTooShort}
          >
            {busy ? 'Saving...' : dialog ? COPY[dialog.decision].verb : ''}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
