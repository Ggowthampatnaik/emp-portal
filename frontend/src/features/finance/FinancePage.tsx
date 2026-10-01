/**
 * Finance: releasing payslips for payment.
 *
 * The portal now has two approvals on the same money, which is confusing
 * unless they are named, so this page says both out loud:
 *
 *   1. an administrator approves the **run** — is the month's calculation right?
 *   2. HR pushes each **payslip** here, and Finance releases it.
 *
 * Finance has no Reject. A payslip it disagrees with is *queried*, which sends
 * it back to HR with a comment — the same reasoning as HR's send-back on leave.
 * Nothing on this page can change an amount: Payroll owns the figures.
 */

import CheckIcon from '@mui/icons-material/Check';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
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
import { EmptyState, ErrorAlert } from '@/components/common/Feedback';
import PageHeader from '@/components/common/PageHeader';
import PayslipBreakdown from '@/features/payroll/PayslipBreakdown';
import { showToast } from '@/features/ui/uiSlice';
import { usePermissions } from '@/hooks/usePermissions';
import { useApiAction, useApiResource } from '@/hooks/useApiResource';
import { financeApi } from '@/services/api/services';
import { money } from '@/utils/format';
import type { PayslipApproval, PayslipApprovalStatus } from '@/types/domain';
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

type Decision = 'release' | 'query';

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
  const [dialog, setDialog] = useState<{ row: PayslipApproval; decision: Decision } | null>(
    null,
  );
  const [comment, setComment] = useState('');

  const { data, loading, error, reload } = useApiResource(
    useCallback(
      () => financeApi.approvals({ page_size: 50, status: status || undefined }),
      [status],
    ),
    [status],
  );

  const release = useApiAction(financeApi.release);
  const query = useApiAction(financeApi.query);
  const busy = release.busy || query.busy;
  const actionError = release.error ?? query.error;

  const queryTooShort = dialog?.decision === 'query' && comment.trim().length < 5;

  const submit = async () => {
    if (!dialog || queryTooShort) return;
    const run = dialog.decision === 'release' ? release.run : query.run;
    const updated = await run(dialog.row.id, comment);
    if (updated) {
      dispatch(
        showToast(
          dialog.decision === 'release'
            ? `${updated.employee_name}'s pay for ${updated.period_label} released.`
            : `Query raised on ${updated.employee_name}'s payslip.`,
          dialog.decision === 'release' ? 'success' : 'info',
        ),
      );
      setDialog(null);
      setComment('');
      void reload();
    }
  };

  const rows = data?.results ?? [];

  return (
    <>
      <PageHeader title="Finance" subtitle="Release approved payslips for payment" />

      <Card>
        <Box sx={{ p: 2 }}>
          <Alert severity="info" sx={{ mb: 2 }}>
            These payslips have already been approved twice over: an administrator signed off
            the monthly run, and HR sent each one here. Releasing is the last step before
            payment — it does not change any amount.
          </Alert>

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
          {loading && <LinearProgress sx={{ mb: 2 }} />}

          {!loading && rows.length === 0 ? (
            <EmptyState
              title="Nothing waiting on Finance"
              detail="Payslips appear here once HR has sent them across for release."
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
                    <TableCell align="right">Decision</TableCell>
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
                            <Stack direction="row" spacing={1} justifyContent="flex-end">
                              <Button
                                size="small"
                                variant="contained"
                                color="success"
                                startIcon={<CheckIcon />}
                                onClick={() => {
                                  setDialog({ row, decision: 'release' });
                                  setComment('');
                                }}
                                disabled={!mayDecide || busy}
                              >
                                Release
                              </Button>
                              <Button
                                size="small"
                                variant="outlined"
                                color="warning"
                                startIcon={<HelpOutlineIcon />}
                                onClick={() => {
                                  setDialog({ row, decision: 'query' });
                                  setComment('');
                                }}
                                disabled={!mayDecide || busy}
                              >
                                Query
                              </Button>
                            </Stack>
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

      <Dialog open={Boolean(dialog)} onClose={() => setDialog(null)} fullWidth maxWidth="sm">
        <ClosableDialogTitle onClose={() => setDialog(null)}>
          {dialog?.decision === 'release' ? 'Release for payment' : 'Raise a query with HR'}
        </ClosableDialogTitle>
        <DialogContent>
          {dialog && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography variant="body2">
                {dialog.row.employee_name} · {dialog.row.period_label} ·{' '}
                <strong>{money(dialog.row.net_pay)}</strong>
              </Typography>

              {dialog.decision === 'release' ? (
                <Alert severity="success">
                  This confirms the payment goes out. The amount is not changed here.
                </Alert>
              ) : (
                <Alert severity="warning">
                  The payslip goes back to {dialog.row.processed_by_name ?? 'HR'} with your
                  question. Finance has no reject — a query keeps it moving.
                </Alert>
              )}

              <TextField
                label={dialog.decision === 'release' ? 'Note' : 'Query'}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                multiline
                minRows={2}
                required={dialog.decision === 'query'}
                error={Boolean(comment) && queryTooShort}
                helperText={
                  dialog.decision === 'query'
                    ? 'Required — say what HR should look at.'
                    : 'Optional.'
                }
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color={dialog?.decision === 'release' ? 'success' : 'warning'}
            onClick={submit}
            disabled={busy || queryTooShort}
          >
            {busy ? 'Saving...' : dialog?.decision === 'release' ? 'Release' : 'Raise query'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
