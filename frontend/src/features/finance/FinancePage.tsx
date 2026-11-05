/**
 * Finance: releasing payslips for payment.
 *
 * HR sends a whole month here. Finance releases it with one click, which pays
 * everyone and shows them their payslip, or sends it back to HR to be redone.
 *
 * Finance has no Reject. A payslip already on hold stays held until HR resends it.
 * Nothing on this page can change an amount: Payroll owns the figures.
 */

import CheckIcon from '@mui/icons-material/Check';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import IconButton from '@mui/material/IconButton';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
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
import { Fragment, useCallback, useState } from 'react';

import { useAppDispatch } from '@/app/hooks';
import ClosableDialogTitle from '@/components/common/ClosableDialogTitle';
import { EmptyState, ErrorAlert, TableSkeleton } from '@/components/common/Feedback';
import PageHeader from '@/components/common/PageHeader';
import PayslipBreakdown from '@/features/payroll/PayslipBreakdown';
import { showToast } from '@/features/ui/uiSlice';
import { usePermissions } from '@/hooks/usePermissions';
import { useApiAction, useApiResource } from '@/hooks/useApiResource';
import { financeApi, payrollApi } from '@/services/api/services';
import { money } from '@/utils/format';
import type { PayrollRun, PayslipApproval, PayslipApprovalStatus } from '@/types/domain';
import { formatDate } from '@/utils/date';

const FILTERS: { value: PayslipApprovalStatus | ''; label: string }[] = [
  { value: 'processed', label: 'Waiting for Finance' },
  { value: 'approved', label: 'Released' },
  { value: 'queried', label: 'Queried' },
  { value: '', label: 'All' },
];

const STATUS_COLOR: Record<PayslipApprovalStatus, 'default' | 'info' | 'success' | 'warning'> =
  {
    pending: 'default',
    processed: 'info',
    approved: 'success',
    queried: 'warning',
  };

/** The expanded row: the same breakdown the employee sees on their own payslip. */
function ApprovalDetail({ approvalId }: { approvalId: number }) {
  const { data, loading, error, reload } = useApiResource(
    useCallback(() => financeApi.approval(approvalId), [approvalId]),
    [approvalId],
  );

  if (loading) return <LinearProgress sx={{ my: 2, maxWidth: 260 }} />;
  if (error) return <ErrorAlert error={error} onRetry={reload} />;
  if (!data?.payslip_detail) return null;

  return (
    <Box sx={{ py: 2 }}>
      <PayslipBreakdown slip={data.payslip_detail} />
      {data.comment && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          Note: {data.comment}
        </Typography>
      )}
    </Box>
  );
}

export default function FinancePage() {
  const dispatch = useAppDispatch();
  const { can } = usePermissions();
  const mayDecide = can('finance.approve');

  const [status, setStatus] = useState<string>('processed');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [releasing, setReleasing] = useState<PayslipApproval | null>(null);
  const [comment, setComment] = useState('');

  const { data, loading, error, reload } = useApiResource(
    useCallback(
      () => financeApi.approvals({ page_size: 50, status: status || undefined }),
      [status],
    ),
    [status],
  );

  const months = useApiResource(
    useCallback(
      () =>
        mayDecide
          ? payrollApi.runs({ status: 'with_finance', page_size: 24 })
          : Promise.resolve({ count: 0, results: [] } as never),
      [mayDecide],
    ),
    [mayDecide],
  );
  const [monthDialog, setMonthDialog] = useState<{
    run: PayrollRun;
    decision: 'release' | 'back';
  } | null>(null);
  const [reason, setReason] = useState('');

  const release = useApiAction(financeApi.release);
  const releaseMonth = useApiAction(payrollApi.releaseMonth);
  const sendBack = useApiAction(payrollApi.sendBack);
  const busy = release.busy || releaseMonth.busy || sendBack.busy;
  const actionError = release.error ?? releaseMonth.error ?? sendBack.error;

  const refresh = () => {
    void reload();
    void months.reload();
  };

  const submitMonth = async () => {
    if (!monthDialog) return;
    const { run, decision } = monthDialog;
    if (decision === 'release') {
      const done = await releaseMonth.run(run.id);
      if (done) {
        dispatch(
          showToast(
            `${run.period_label}: ${done.released} released${
              done.held ? `, ${done.held} held back` : ''
            }.`,
            'success',
          ),
        );
      }
    } else {
      const done = await sendBack.run(run.id, reason);
      if (done) dispatch(showToast(`${run.period_label} sent back to HR.`, 'info'));
    }
    setMonthDialog(null);
    setReason('');
    refresh();
  };

  const submit = async () => {
    if (!releasing) return;
    const updated = await release.run(releasing.id, comment);
    if (updated) {
      dispatch(
        showToast(
          `${updated.employee_name}'s pay for ${updated.period_label} released.`,
          'success',
        ),
      );
      setReleasing(null);
      setComment('');
      refresh();
    }
  };

  const rows = data?.results ?? [];

  return (
    <>
      <PageHeader title="Finance" subtitle="Release payroll sent by HR" />

      <Card>
        <Box sx={{ p: 2 }}>
          <Alert severity="info" sx={{ mb: 2 }}>
            HR sends each month here. Release the month to pay everyone, or release one payslip
            at a time. Neither changes any amount.
          </Alert>

          {months.data?.results.map((run) => (
            <Stack
              key={run.id}
              direction={{ xs: 'column', sm: 'row' }}
              justifyContent="space-between"
              alignItems={{ sm: 'center' }}
              spacing={1}
              sx={{ mb: 2, p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}
            >
              <Box>
                <Typography variant="body1" fontWeight={700}>
                  {run.period_label}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {run.employee_count} payslips · net {money(run.total_net)}
                  {run.sent_by_name ? ` · sent by ${run.sent_by_name}` : ''}
                </Typography>
              </Box>
              <Stack direction="row" spacing={1}>
                <Button
                  variant="outlined"
                  color="warning"
                  disabled={busy}
                  onClick={() => {
                    setMonthDialog({ run, decision: 'back' });
                    setReason('');
                  }}
                >
                  Send back to HR
                </Button>
                <Button
                  variant="contained"
                  color="success"
                  startIcon={<CheckIcon />}
                  disabled={busy}
                  onClick={() => setMonthDialog({ run, decision: 'release' })}
                >
                  Release month
                </Button>
              </Stack>
            </Stack>
          ))}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
            <TextField
              select
              size="small"
              label="Show"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              sx={{ minWidth: 220 }}
            >
              {FILTERS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          {actionError && <ErrorAlert error={actionError} />}
          {error && <ErrorAlert error={error} onRetry={reload} />}
          {loading && <TableSkeleton rows={5} columns={6} />}

          {!loading && rows.length === 0 ? (
            <EmptyState
              title="Nothing waiting on Finance"
              detail="Payslips appear here once HR has sent the month to Finance."
            />
          ) : (
            <TableContainer sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell width={48} />
                    <TableCell>Employee</TableCell>
                    <TableCell>Period</TableCell>
                    <TableCell align="right">Net pay</TableCell>
                    <TableCell>Sent by HR</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => (
                    <Fragment key={row.id}>
                      <TableRow hover>
                        <TableCell>
                          <IconButton
                            size="small"
                            aria-label={`Show ${row.employee_name}'s breakdown`}
                            onClick={() => setExpanded(expanded === row.id ? null : row.id)}
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
                        <TableCell>{row.period_label}</TableCell>
                        <TableCell align="right">
                          <Typography variant="body2" fontWeight={700}>
                            {money(row.net_pay)}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">
                            {row.processed_by_name ?? '—'}
                          </Typography>
                          {row.processed_at && (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              display="block"
                            >
                              {formatDate(row.processed_at)}
                            </Typography>
                          )}
                          {/* Releasing is the independent check on a payslip
                              its own recipient pushed here, so the queue says
                              which ones those are rather than leaving the
                              releaser to spot the matching names. */}
                          {row.self_processed && (
                            <Tooltip title="Sent to Finance by the employee it pays. Releasing is the independent check.">
                              <Chip
                                size="small"
                                color="warning"
                                variant="outlined"
                                label="Own payslip"
                                sx={{ mt: 0.5 }}
                              />
                            </Tooltip>
                          )}
                        </TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            color={STATUS_COLOR[row.status]}
                            variant={row.status === 'approved' ? 'filled' : 'outlined'}
                            label={row.status_label}
                          />
                        </TableCell>
                        <TableCell align="right">
                          {row.awaits_finance ? (
                            <Button
                              size="small"
                              variant="contained"
                              color="success"
                              startIcon={<CheckIcon />}
                              onClick={() => {
                                setReleasing(row);
                                setComment('');
                              }}
                              disabled={!mayDecide || busy}
                            >
                              Release
                            </Button>
                          ) : (
                            <Typography variant="caption" color="text.disabled">
                              {row.approved_by_name ? `by ${row.approved_by_name}` : '—'}
                            </Typography>
                          )}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell colSpan={7} sx={{ py: 0, borderBottom: 0 }}>
                          <Collapse in={expanded === row.id} unmountOnExit>
                            <Box sx={{ pl: 5, pr: 2 }}>
                              <ApprovalDetail approvalId={row.id} />
                            </Box>
                          </Collapse>
                        </TableCell>
                      </TableRow>
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Box>
      </Card>

      <Dialog
        open={Boolean(releasing)}
        onClose={() => setReleasing(null)}
        fullWidth
        maxWidth="sm"
      >
        <ClosableDialogTitle onClose={() => setReleasing(null)}>
          Release for payment
        </ClosableDialogTitle>
        <DialogContent>
          {releasing && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography variant="body2">
                {releasing.employee_name} · {releasing.period_label} ·{' '}
                <strong>{money(releasing.net_pay)}</strong>
              </Typography>
              <Alert severity="success">
                This confirms the payment goes out. The amount is not changed here.
              </Alert>
              <TextField
                label="Note"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                multiline
                minRows={2}
                helperText="Optional."
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReleasing(null)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="contained" color="success" onClick={submit} disabled={busy}>
            {busy ? 'Saving...' : 'Release'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(monthDialog)}
        onClose={() => setMonthDialog(null)}
        fullWidth
        maxWidth="sm"
      >
        <ClosableDialogTitle onClose={() => setMonthDialog(null)}>
          {monthDialog?.decision === 'release' ? 'Release' : 'Send back'}{' '}
          {monthDialog?.run.period_label}
        </ClosableDialogTitle>
        <DialogContent>
          {monthDialog?.decision === 'release' ? (
            <Alert severity="success" sx={{ mt: 1 }}>
              Everyone in {monthDialog.run.period_label} still waiting is paid and can see their
              payslip. Any payslip on hold stays held back.
            </Alert>
          ) : (
            <TextField
              label="What needs correcting?"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              multiline
              minRows={2}
              required
              fullWidth
              sx={{ mt: 1 }}
              error={!reason.trim()}
              helperText="Required - HR sees this. Not possible once any payslip is released."
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMonthDialog(null)}>Cancel</Button>
          <Button
            variant="contained"
            color={monthDialog?.decision === 'release' ? 'success' : 'warning'}
            disabled={busy || (monthDialog?.decision === 'back' && !reason.trim())}
            onClick={() => void submitMonth()}
          >
            {monthDialog?.decision === 'release' ? 'Release month' : 'Send back to HR'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
