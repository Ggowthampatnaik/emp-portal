/**
 * Monthly payroll runs.
 *
 * HR opens and processes a month and sends it to Finance, which releases it
 * from the Finance page. The buttons shown follow the run's status and the
 * caller's permissions, so an action is never offered that the server would
 * refuse.
 */

import AddIcon from '@mui/icons-material/Add';
import DownloadIcon from '@mui/icons-material/Download';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
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
import { EmptyState, ErrorAlert, TableSkeleton } from '@/components/common/Feedback';
import { showToast } from '@/features/ui/uiSlice';
import { usePermissions } from '@/hooks/usePermissions';
import { useApiAction, useApiResource } from '@/hooks/useApiResource';
import { downloadBlob, payrollApi } from '@/services/api/services';
import { money } from '@/utils/format';
import type {
  PayrollRun,
  PayrollRunDetail,
  PayrollRunStatus,
  PayslipApprovalStatus,
  UnapprovedTimesheets,
} from '@/types/domain';
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

/**
 * Column widths shared by the runs table and the payslip table that opens
 * under a run, so the payslip's Employee sits under Period, Paid days under
 * Status, Unpaid under Employees, and Gross, Deductions and Net under their
 * namesakes. In pixels, each just wider than its widest content: percentages
 * grew with the table and took the room Period needs. Period (and the payslip's
 * Employee) takes what is left; Actions is sized to the buttons on show (see
 * actionsWidth), so there is no empty strip down the right-hand side. Everything
 * reads from the left.
 */
const COL = {
  expander: 56,
  status: 135,
  employees: 105,
  gross: 125,
  deductions: 115,
  net: 125,
} as const;

/** The empty first column of the payslip table, under the runs' arrows. */
const INDENT_SX = { bgcolor: 'transparent', borderBottom: 0, width: COL.expander } as const;

const STATUS_COLOR: Record<PayrollRunStatus, 'default' | 'warning' | 'success' | 'primary'> = {
  draft: 'default',
  processed: 'warning',
  with_finance: 'primary',
  paid: 'success',
};

const STATUS_LABEL: Record<PayrollRunStatus, string> = {
  draft: 'Draft',
  processed: 'Processed',
  with_finance: 'With Finance',
  paid: 'Paid',
};

/** What HR can do about a payslip: only one Finance does not hold can be sent. */
function financeButton(status: PayslipApprovalStatus | null) {
  if (status === 'processed') return { label: 'With Finance', sendable: false };
  if (status === 'approved') return { label: 'Released', sendable: false };
  if (status === 'queried') return { label: 'Resend', sendable: true };
  return { label: 'Send', sendable: true };
}

export default function PayrollRunsTab() {
  const dispatch = useAppDispatch();
  const { can } = usePermissions();
  const mayProcess = can('payroll.process');
  const mayPush = can('payroll.push_to_finance');
  const mayExport = can('report.export');

  // Finance reads this tab and acts from its own page, so it has no such column.
  const hasActions = mayProcess || mayPush || mayExport;

  const [expanded, setExpanded] = useState<number | null>(null);
  const [detail, setDetail] = useState<PayrollRunDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const push = useApiAction(payrollApi.pushToFinance);
  const [sending, setSending] = useState<PayrollRun | null>(null);
  const [unapproved, setUnapproved] = useState<UnapprovedTimesheets[] | null>(null);

  const now = new Date();
  const [form, setForm] = useState({
    year: String(now.getFullYear()),
    month: String(now.getMonth() + 1),
  });

  const { data, loading, error, reload } = useApiResource(
    useCallback(() => payrollApi.runs({ page_size: 24 }), []),
    [],
  );

  // Just wide enough for Send to Finance, the widest thing in the column, which
  // also fits the Finance button under an opened run. The narrower buttons
  // stretch to the same width, so nothing is left empty on the right.
  const actionsWidth = mayProcess || mayPush ? 170 : 80;

  const createRun = useApiAction(payrollApi.createRun);
  const process = useApiAction(payrollApi.process);
  const check = useApiAction(payrollApi.timesheetCheck);
  const sendToFinance = useApiAction(payrollApi.sendToFinance);

  const busy = createRun.busy || process.busy || sendToFinance.busy;
  const actionError = createRun.error ?? process.error ?? sendToFinance.error ?? push.error;

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
    if (!created) return;
    setCreating(false);

    // Straight on to the figures: an opened month with nothing in it is no use
    // to anyone. If they cannot be worked out, the draft stays with the reason.
    const processed = await process.run(created.id);
    if (processed) after(`${processed.period_label} opened and processed.`);
    else void reload();
  };

  /** Asks first who has unapproved timesheets: it warns, and never stops HR. */
  const openSend = async (run: PayrollRun) => {
    setSending(run);
    setUnapproved(null);
    const result = await check.run(run.id);
    if (result) setUnapproved(result.unapproved);
  };

  const handleSend = async () => {
    if (!sending) return;
    const done = await sendToFinance.run(sending.id);
    setSending(null);
    if (done) after(`${done.period_label} sent to Finance.`);
  };

  /** One payslip back in front of Finance, usually after answering a query. */
  const handlePush = async (slip: { id: number; employee_name: string }) => {
    const sent = await push.run(slip.id);
    if (sent) {
      setDetail(
        (current) =>
          current && {
            ...current,
            payslips: current.payslips.map((row) =>
              row.id === slip.id ? { ...row, finance_status: 'processed' } : row,
            ),
          },
      );
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

  if (loading) return <TableSkeleton rows={6} columns={7} />;
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
              ? 'Open a month to work out payslips from the current salary structures.'
              : 'Payroll has not been run yet.'
          }
        />
      ) : (
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ tableLayout: 'fixed', minWidth: 900 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: COL.expander }} />
                <TableCell>Period</TableCell>
                <TableCell sx={{ width: COL.status }}>Status</TableCell>
                <TableCell sx={{ width: COL.employees }}>Employees</TableCell>
                <TableCell sx={{ width: COL.gross }}>Gross</TableCell>
                <TableCell sx={{ width: COL.deductions }}>Deductions</TableCell>
                <TableCell sx={{ width: COL.net }}>Net</TableCell>
                {hasActions && <TableCell sx={{ width: actionsWidth }}>Actions</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {data.results.map((run) => (
                <Fragment key={run.id}>
                  {/* The whole row opens the run's payslips, not just the arrow.
                      A run with nobody in it has nothing to open. */}
                  <TableRow
                    hover
                    onClick={run.employee_count === 0 ? undefined : () => void toggle(run)}
                    selected={expanded === run.id}
                    sx={{ cursor: run.employee_count === 0 ? 'default' : 'pointer' }}
                  >
                    <TableCell>
                      <IconButton
                        size="small"
                        onClick={(event) => {
                          // The row toggles too; once is enough.
                          event.stopPropagation();
                          void toggle(run);
                        }}
                        aria-label="Show payslips"
                        aria-expanded={expanded === run.id}
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
                        <Typography variant="caption" color="text.secondary" display="block">
                          processed by {run.processed_by_name}
                          {run.sent_by_name && (
                            <>
                              <br />
                              sent by {run.sent_by_name}
                            </>
                          )}
                          {run.paid_by_name && (
                            <>
                              <br />
                              released by {run.paid_by_name}
                            </>
                          )}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={STATUS_LABEL[run.status]}
                        color={STATUS_COLOR[run.status]}
                        variant={run.status === 'draft' ? 'outlined' : 'filled'}
                      />
                    </TableCell>
                    <TableCell>{run.employee_count || '-'}</TableCell>
                    <TableCell>{run.employee_count ? money(run.total_gross) : '-'}</TableCell>
                    <TableCell>
                      {run.employee_count ? money(run.total_deductions) : '-'}
                    </TableCell>
                    <TableCell>
                      {run.employee_count ? <strong>{money(run.total_net)}</strong> : '-'}
                    </TableCell>
                    {hasActions && (
                      // Process, send, export: none of them is a request to open the
                      // payslips, so clicks here stay out of the row's.
                      <TableCell onClick={(event) => event.stopPropagation()} sx={{ pr: 1 }}>
                        <Stack spacing={0.75}>
                          <Stack direction="row" spacing={0.5} alignItems="center">
                            {mayProcess && run.is_editable && (
                              <Button
                                size="small"
                                variant="outlined"
                                startIcon={<PlayArrowIcon />}
                                disabled={busy}
                                sx={{ flexGrow: 1, whiteSpace: 'nowrap' }}
                                onClick={async () => {
                                  const done = await process.run(run.id);
                                  if (done) after(`${done.period_label} processed.`);
                                }}
                              >
                                {run.status === 'draft' ? 'Process' : 'Reprocess'}
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
                          {mayPush && run.status === 'processed' && (
                            <Button
                              size="small"
                              variant="contained"
                              startIcon={<SendIcon />}
                              disabled={busy}
                              onClick={() => void openSend(run)}
                              sx={{ whiteSpace: 'nowrap' }}
                            >
                              Send to Finance
                            </Button>
                          )}
                        </Stack>
                      </TableCell>
                    )}
                  </TableRow>

                  <TableRow>
                    <TableCell colSpan={hasActions ? 8 : 7} sx={{ p: 0, borderBottom: 0 }}>
                      <Collapse in={expanded === run.id} unmountOnExit>
                        <Box sx={{ py: 2 }}>
                          {run.notes && (
                            <Alert severity="warning" sx={{ mb: 2, ml: '56px', mr: 2 }}>
                              Sent back by Finance: {run.notes}
                            </Alert>
                          )}
                          {!detail ? (
                            <LinearProgress sx={{ maxWidth: 240, ml: '72px' }} />
                          ) : (
                            <Table size="small" sx={{ tableLayout: 'fixed' }}>
                              <TableHead>
                                <TableRow>
                                  <TableCell sx={INDENT_SX} />
                                  <TableCell>Employee</TableCell>
                                  <TableCell sx={{ width: COL.status }}>Paid days</TableCell>
                                  <TableCell sx={{ width: COL.employees }}>Unpaid</TableCell>
                                  <TableCell sx={{ width: COL.gross }}>Gross</TableCell>
                                  <TableCell sx={{ width: COL.deductions }}>
                                    Deductions
                                  </TableCell>
                                  <TableCell sx={{ width: COL.net }}>Net</TableCell>
                                  {hasActions && (
                                    <TableCell sx={{ width: actionsWidth }}>
                                      {mayPush ? 'Finance' : null}
                                    </TableCell>
                                  )}
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {detail.payslips.map((slip) => {
                                  const finance = financeButton(slip.finance_status);
                                  return (
                                    <TableRow key={slip.id}>
                                      <TableCell sx={INDENT_SX} />
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
                                      <TableCell>{slip.paid_days}</TableCell>
                                      <TableCell>
                                        {Number(slip.lop_days) > 0 ? slip.lop_days : '-'}
                                      </TableCell>
                                      <TableCell>{money(slip.gross_earnings)}</TableCell>
                                      <TableCell>{money(slip.total_deductions)}</TableCell>
                                      <TableCell>
                                        <strong>{money(slip.net_pay)}</strong>
                                      </TableCell>
                                      {hasActions && (
                                        <TableCell>
                                          {mayPush && run.is_locked && (
                                            <Button
                                              size="small"
                                              variant="outlined"
                                              startIcon={<SendIcon />}
                                              onClick={() => void handlePush(slip)}
                                              disabled={!finance.sendable || push.busy}
                                            >
                                              {finance.label}
                                            </Button>
                                          )}
                                        </TableCell>
                                      )}
                                    </TableRow>
                                  );
                                })}
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
              Opening a month works out a payslip for every employee who has a salary structure
              in force. You can reprocess it until it is sent to Finance.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreating(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreate}
            disabled={createRun.busy || process.busy}
          >
            {createRun.busy || process.busy ? 'Opening...' : 'Open'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Send to Finance */}
      <Dialog open={Boolean(sending)} onClose={() => setSending(null)} fullWidth maxWidth="sm">
        <ClosableDialogTitle onClose={() => setSending(null)}>
          Send {sending?.period_label} to Finance
        </ClosableDialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2">
              {sending?.employee_count} payslips, net {money(sending?.total_net ?? '0')}. The
              month is locked once it is sent, unless Finance sends it back.
            </Typography>
            {check.busy && <LinearProgress />}
            {check.error && (
              <Alert severity="warning">
                The timesheets could not be checked. You can still send the month.
              </Alert>
            )}
            {unapproved?.length === 0 && (
              <Alert severity="success">Every timesheet for this month is approved.</Alert>
            )}
            {unapproved && unapproved.length > 0 && (
              <Alert severity="warning">
                <Typography variant="body2" gutterBottom>
                  {unapproved.length} employee{unapproved.length === 1 ? ' has' : 's have'}{' '}
                  timesheets not yet approved. You can still send the month.
                </Typography>
                <Box sx={{ maxHeight: 180, overflowY: 'auto' }}>
                  {unapproved.map((person) => (
                    <Typography key={person.employee_code} variant="caption" display="block">
                      {person.name} ({person.employee_code}): {person.weeks}{' '}
                      {person.weeks === 1 ? 'week' : 'weeks'}
                    </Typography>
                  ))}
                </Box>
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSending(null)}>Cancel</Button>
          <Button
            variant="contained"
            startIcon={<SendIcon />}
            disabled={check.busy || sendToFinance.busy}
            onClick={() => void handleSend()}
          >
            {sendToFinance.busy ? 'Sending...' : 'Send to Finance'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
