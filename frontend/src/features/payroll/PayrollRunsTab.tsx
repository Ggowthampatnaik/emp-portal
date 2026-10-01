/**
 * Monthly payroll runs.
 *
 * The workflow is maker-checker: whoever holds `payroll.process` opens and
 * processes a run, and someone holding `payroll.approve` signs it off. The
 * buttons shown follow the run's status and the caller's permissions, so an
 * action is never offered that the server would refuse.
 */

import AddIcon from '@mui/icons-material/Add';
import CheckIcon from '@mui/icons-material/Check';
import DownloadIcon from '@mui/icons-material/Download';
import PaymentsIcon from '@mui/icons-material/Payments';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import UndoIcon from '@mui/icons-material/Undo';
import SendIcon from '@mui/icons-material/Send';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
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
import Typography from '@mui/material/Typography';
import { Fragment, useCallback, useState } from 'react';

import { useAppDispatch } from '@/app/hooks';
import { EmptyState, ErrorAlert } from '@/components/common/Feedback';
import { showToast } from '@/features/ui/uiSlice';
import { usePermissions } from '@/hooks/usePermissions';
import { useApiAction, useApiResource } from '@/hooks/useApiResource';
import { downloadBlob, payrollApi } from '@/services/api/services';
import { money } from '@/utils/format';
import type { PayrollRun, PayrollRunDetail, PayrollRunStatus } from '@/types/domain';
import ClosableDialogTitle from '@/components/common/ClosableDialogTitle';

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

const STATUS_COLOR: Record<PayrollRunStatus, 'default' | 'warning' | 'success' | 'primary'> = {
  draft: 'default',
  processed: 'warning',
  approved: 'primary',
  paid: 'success',
};

export default function PayrollRunsTab() {
  const dispatch = useAppDispatch();
  const { can } = usePermissions();
  const mayProcess = can('payroll.process');
  const mayApprove = can('payroll.approve');
  const mayExport = can('report.export');

  const [expanded, setExpanded] = useState<number | null>(null);
  const [detail, setDetail] = useState<PayrollRunDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [pushed, setPushed] = useState<Set<number>>(new Set());
  const push = useApiAction(payrollApi.pushToFinance);
  const mayPush = can('payroll.push_to_finance');
  const [rejecting, setRejecting] = useState<PayrollRun | null>(null);
  const [comment, setComment] = useState('');

  const now = new Date();
  const [form, setForm] = useState({
    year: String(now.getFullYear()),
    month: String(now.getMonth() + 1),
  });

  const { data, loading, error, reload } = useApiResource(
    useCallback(() => payrollApi.runs({ page_size: 24 }), []),
    [],
  );

  const createRun = useApiAction(payrollApi.createRun);
  const process = useApiAction(payrollApi.process);
  const approve = useApiAction(payrollApi.approve);
  const reject = useApiAction(payrollApi.reject);
  const markPaid = useApiAction(payrollApi.markPaid);

  const busy = createRun.busy || process.busy || approve.busy || reject.busy || markPaid.busy;
  const actionError =
    createRun.error ?? process.error ?? approve.error ?? reject.error ?? markPaid.error;

  const toggle = async (run: PayrollRun) => {
    if (expanded === run.id) {
      setExpanded(null);
      return;
    }
    setExpanded(run.id);
    setDetail(null);
    setDetail(await payrollApi.run(run.id).catch(() => null));
  };

  const after = (message: string) => {
    dispatch(showToast(message, 'success'));
    setExpanded(null);
    void reload();
  };

  const handleCreate = async () => {
    const created = await createRun.run(Number(form.year), Number(form.month));
    if (created) {
      setCreating(false);
      after(`${created.period_label} opened.`);
    }
  };

  /**
   * Push one payslip to Finance for release. Only possible once the run itself
   * has been approved - Finance is never asked to release money out of a month
   * nobody has signed off, and the backend refuses it too.
   */
  const handlePush = async (slip: { id: number; employee_name: string }) => {
    const sent = await push.run(slip.id);
    if (sent) {
      setPushed((current) => new Set(current).add(slip.id));
      dispatch(showToast(`${slip.employee_name}'s payslip sent to Finance.`, 'success'));
    }
  };

  const handleExport = async (run: PayrollRun) => {
    try {
      const blob = await payrollApi.exportRun(run.id);
      downloadBlob(blob, `payroll-${run.year}-${String(run.month).padStart(2, '0')}.csv`);
    } catch {
      dispatch(showToast('The export could not be generated.', 'error'));
    }
  };

  if (loading) return <LinearProgress />;
  if (error) return <ErrorAlert error={error} onRetry={reload} />;

  return (
    <>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary">
          {data?.count ?? 0} run{data?.count === 1 ? '' : 's'}
        </Typography>
        {mayProcess && (
          <Button startIcon={<AddIcon />} variant="contained" onClick={() => setCreating(true)}>
            Open a month
          </Button>
        )}
      </Stack>

      {actionError && <ErrorAlert error={actionError} />}

      {!data?.results.length ? (
        <EmptyState
          title="No payroll runs yet"
          detail={
            mayProcess
              ? 'Open a month to generate payslips from the current salary structures.'
              : 'Payroll has not been run yet.'
          }
        />
      ) : (
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell width={48} />
                <TableCell>Period</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Employees</TableCell>
                <TableCell align="right">Gross</TableCell>
                <TableCell align="right">Deductions</TableCell>
                <TableCell align="right">Net</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.results.map((run) => (
                <Fragment key={run.id}>
                  <TableRow hover>
                    <TableCell>
                      <IconButton
                        size="small"
                        onClick={() => void toggle(run)}
                        aria-label="Show payslips"
                        disabled={run.employee_count === 0}
                      >
                        {expanded === run.id ? (
                          <KeyboardArrowUpIcon />
                        ) : (
                          <KeyboardArrowDownIcon />
                        )}
                      </IconButton>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>
                        {run.period_label}
                      </Typography>
                      {run.processed_by_name && (
                        <Typography variant="caption" color="text.secondary">
                          processed by {run.processed_by_name}
                          {run.approved_by_name ? ` · approved by ${run.approved_by_name}` : ''}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={run.status}
                        color={STATUS_COLOR[run.status]}
                        variant={run.status === 'draft' ? 'outlined' : 'filled'}
                      />
                    </TableCell>
                    <TableCell align="right">{run.employee_count || '-'}</TableCell>
                    <TableCell align="right">{money(run.total_gross)}</TableCell>
                    <TableCell align="right">{money(run.total_deductions)}</TableCell>
                    <TableCell align="right">
                      <strong>{money(run.total_net)}</strong>
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={1} justifyContent="flex-end">
                        {mayProcess && run.is_editable && (
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<PlayArrowIcon />}
                            disabled={busy}
                            onClick={async () => {
                              const done = await process.run(run.id);
                              if (done) after(`${done.period_label} processed.`);
                            }}
                          >
                            {run.status === 'draft' ? 'Process' : 'Reprocess'}
                          </Button>
                        )}
                        {mayApprove && run.status === 'processed' && (
                          <>
                            <Button
                              size="small"
                              variant="contained"
                              color="success"
                              startIcon={<CheckIcon />}
                              disabled={busy}
                              onClick={async () => {
                                const done = await approve.run(run.id);
                                if (done) after(`${done.period_label} approved.`);
                              }}
                            >
                              Approve
                            </Button>
                            <Button
                              size="small"
                              color="error"
                              startIcon={<UndoIcon />}
                              disabled={busy}
                              onClick={() => {
                                setRejecting(run);
                                setComment('');
                              }}
                            >
                              Send back
                            </Button>
                          </>
                        )}
                        {mayApprove && run.status === 'approved' && (
                          <Button
                            size="small"
                            variant="contained"
                            startIcon={<PaymentsIcon />}
                            disabled={busy}
                            onClick={async () => {
                              const done = await markPaid.run(run.id);
                              if (done) after(`${done.period_label} marked paid.`);
                            }}
                          >
                            Mark paid
                          </Button>
                        )}
                        {mayExport && run.employee_count > 0 && (
                          <IconButton
                            size="small"
                            aria-label="Export bank sheet"
                            onClick={() => void handleExport(run)}
                          >
                            <DownloadIcon fontSize="small" />
                          </IconButton>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>

                  <TableRow>
                    <TableCell colSpan={8} sx={{ py: 0, borderBottom: 0 }}>
                      <Collapse in={expanded === run.id} unmountOnExit>
                        <Box sx={{ py: 2, pl: 6 }}>
                          {run.notes && (
                            <Alert severity="warning" sx={{ mb: 2 }}>
                              Sent back: {run.notes}
                            </Alert>
                          )}
                          {!detail ? (
                            <LinearProgress sx={{ maxWidth: 240 }} />
                          ) : (
                            <Table size="small">
                              <TableHead>
                                <TableRow>
                                  <TableCell>Employee</TableCell>
                                  <TableCell align="right">Paid days</TableCell>
                                  <TableCell align="right">Unpaid</TableCell>
                                  <TableCell align="right">Gross</TableCell>
                                  <TableCell align="right">Deductions</TableCell>
                                  <TableCell align="right">Net</TableCell>
                                  {mayPush && <TableCell align="right">Finance</TableCell>}
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {detail.payslips.map((slip) => (
                                  <TableRow key={slip.id}>
                                    <TableCell>
                                      {slip.employee_name}
                                      <Typography
                                        variant="caption"
                                        color="text.secondary"
                                        display="block"
                                      >
                                        {slip.employee_code}
                                        {slip.department_name
                                          ? ` · ${slip.department_name}`
                                          : ''}
                                      </Typography>
                                    </TableCell>
                                    <TableCell align="right">{slip.paid_days}</TableCell>
                                    <TableCell align="right">
                                      {Number(slip.lop_days) > 0 ? slip.lop_days : '-'}
                                    </TableCell>
                                    <TableCell align="right">
                                      {money(slip.gross_earnings)}
                                    </TableCell>
                                    <TableCell align="right">
                                      {money(slip.total_deductions)}
                                    </TableCell>
                                    <TableCell align="right">
                                      <strong>{money(slip.net_pay)}</strong>
                                    </TableCell>
                                    {mayPush && (
                                      <TableCell align="right">
                                        <Button
                                          size="small"
                                          variant="outlined"
                                          startIcon={<SendIcon />}
                                          onClick={() => void handlePush(slip)}
                                          disabled={
                                            pushed.has(slip.id) ||
                                            push.busy ||
                                            // Finance only sees payslips out of a
                                            // month an administrator has signed off.
                                            !['approved', 'paid'].includes(run.status)
                                          }
                                        >
                                          {pushed.has(slip.id) ? 'Sent' : 'Send'}
                                        </Button>
                                      </TableCell>
                                    )}
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
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
      )}

      {/* Open a month */}
      <Dialog open={creating} onClose={() => setCreating(false)} fullWidth maxWidth="xs">
        <ClosableDialogTitle onClose={() => setCreating(false)}>
          Open a payroll month
        </ClosableDialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {createRun.error && <Alert severity="error">{createRun.error.message}</Alert>}
            <TextField
              select
              label="Month"
              value={form.month}
              onChange={(event) => setForm({ ...form, month: event.target.value })}
              error={Boolean(createRun.fieldErrors.month)}
              helperText={createRun.fieldErrors.month ?? ' '}
            >
              {MONTHS.map((name, index) => (
                <MenuItem key={name} value={String(index + 1)}>
                  {name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Year"
              type="number"
              value={form.year}
              onChange={(event) => setForm({ ...form, year: event.target.value })}
              error={Boolean(createRun.fieldErrors.year)}
              helperText={createRun.fieldErrors.year ?? ' '}
            />
            <Typography variant="caption" color="text.secondary">
              Opening a month creates a draft. Processing it generates a payslip for every
              employee who has a salary structure in force.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreating(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={createRun.busy}>
            {createRun.busy ? 'Opening...' : 'Open'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Send back */}
      <Dialog
        open={Boolean(rejecting)}
        onClose={() => setRejecting(null)}
        fullWidth
        maxWidth="sm"
      >
        <ClosableDialogTitle onClose={() => setRejecting(null)}>
          Send {rejecting?.period_label} back
        </ClosableDialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="What needs correcting?"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              multiline
              minRows={2}
              required
              error={!comment.trim()}
              helperText="Required - whoever processed the run sees this."
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejecting(null)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            disabled={reject.busy || !comment.trim()}
            onClick={async () => {
              if (!rejecting) return;
              const done = await reject.run(rejecting.id, comment);
              if (done) {
                setRejecting(null);
                after(`${done.period_label} sent back to draft.`);
              }
            }}
          >
            {reject.busy ? 'Sending...' : 'Send back'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
