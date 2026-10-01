/**
 * Account closures awaiting an administrator.
 *
 * HR raises these on the employee record; this is where they are decided. The
 * copy leans hard on one point, because the button HR pressed says "Delete
 * profile": approving **deactivates**. Nothing is removed — leave, timesheets
 * and payslips outlive the person's access, and payroll records have to.
 *
 * Whoever raised a request cannot decide on it. The backend enforces that; the
 * queue simply shows who asked, so an administrator can see whose request it is.
 */

import BlockIcon from '@mui/icons-material/Block';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
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
import { useCallback, useState } from 'react';

import { useAppDispatch } from '@/app/hooks';
import { EmptyState, ErrorAlert } from '@/components/common/Feedback';
import StatusChip from '@/components/common/StatusChip';
import ClosableDialogTitle from '@/components/common/ClosableDialogTitle';
import { showToast } from '@/features/ui/uiSlice';
import { useApiAction, useApiResource } from '@/hooks/useApiResource';
import { adminApi } from '@/services/api/services';
import type { AccountDeletionRequest } from '@/types/domain';

const FILTERS = [
  { value: 'pending', label: 'Awaiting a decision' },
  { value: 'approved', label: 'Closed' },
  { value: 'rejected', label: 'Declined' },
  { value: '', label: 'All' },
];

type Decision = 'approve' | 'reject';

export default function DeletionRequestsTab() {
  const dispatch = useAppDispatch();
  const [status, setStatus] = useState('pending');
  const [dialog, setDialog] = useState<{
    request: AccountDeletionRequest;
    decision: Decision;
  } | null>(null);
  const [note, setNote] = useState('');

  const { data, loading, error, reload } = useApiResource(
    useCallback(
      () => adminApi.deletionRequests({ page_size: 50, status: status || undefined }),
      [status],
    ),
    [status],
  );

  const approve = useApiAction(adminApi.approveDeletion);
  const reject = useApiAction(adminApi.rejectDeletion);
  const busy = approve.busy || reject.busy;
  const actionError = approve.error ?? reject.error;

  const rejectTooShort = dialog?.decision === 'reject' && !note.trim();

  const submit = async () => {
    if (!dialog || rejectTooShort) return;
    const run = dialog.decision === 'approve' ? approve.run : reject.run;
    const updated = await run(dialog.request.id, note);
    if (updated) {
      dispatch(
        showToast(
          dialog.decision === 'approve'
            ? `${updated.employee_name}'s account has been deactivated.`
            : `The request for ${updated.employee_name} was declined.`,
          dialog.decision === 'approve' ? 'success' : 'info',
        ),
      );
      setDialog(null);
      setNote('');
      void reload();
    }
  };

  return (
    <Box sx={{ p: 2 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        alignItems={{ sm: 'center' }}
        sx={{ mb: 2 }}
      >
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
        <Typography variant="body2" color="text.secondary">
          Approving deactivates the account. No record is deleted.
        </Typography>
      </Stack>

      {actionError && <ErrorAlert error={actionError} />}
      {error && <ErrorAlert error={error} onRetry={reload} />}
      {loading && <LinearProgress sx={{ mb: 2 }} />}

      {!loading && data?.results.length === 0 ? (
        <EmptyState
          title="Nothing waiting on you"
          detail="HR raises account closures from the employee record; they appear here to be decided."
        />
      ) : (
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Employee</TableCell>
                <TableCell>Requested by</TableCell>
                <TableCell>Reason</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Decision</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(data?.results ?? []).map((row) => (
                <TableRow key={row.id} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>
                      {row.employee_name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {row.employee_code}
                      {row.department_name ? ` · ${row.department_name}` : ''}
                      {row.designation_name ? ` · ${row.designation_name}` : ''}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{row.requested_by_name ?? '—'}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {new Date(row.requested_at).toLocaleDateString()}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ maxWidth: 280 }}>
                    <Typography variant="body2" title={row.reason}>
                      {row.reason}
                    </Typography>
                    {row.decision_note && (
                      <Typography variant="caption" color="text.secondary" display="block">
                        Decision: {row.decision_note}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusChip status={row.status} />
                  </TableCell>
                  <TableCell align="right">
                    {row.is_open ? (
                      <Stack direction="row" spacing={1} justifyContent="flex-end">
                        <Button
                          size="small"
                          variant="contained"
                          color="error"
                          startIcon={<BlockIcon />}
                          onClick={() => {
                            setDialog({ request: row, decision: 'approve' });
                            setNote('');
                          }}
                          disabled={busy}
                        >
                          Deactivate
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<CloseIcon />}
                          onClick={() => {
                            setDialog({ request: row, decision: 'reject' });
                            setNote('');
                          }}
                          disabled={busy}
                        >
                          Decline
                        </Button>
                      </Stack>
                    ) : (
                      <Typography variant="caption" color="text.disabled">
                        {row.decided_by_name ? `by ${row.decided_by_name}` : 'No longer open'}
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={Boolean(dialog)} onClose={() => setDialog(null)} fullWidth maxWidth="sm">
        <ClosableDialogTitle onClose={() => setDialog(null)}>
          {dialog?.decision === 'approve' ? 'Deactivate this account' : 'Decline the request'}
        </ClosableDialogTitle>
        <DialogContent>
          {dialog && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography variant="body2">
                {dialog.request.employee_name} · {dialog.request.employee_code} ·{' '}
                {dialog.request.employee_email}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {dialog.request.requested_by_name} asked for this: “{dialog.request.reason}”
              </Typography>

              {dialog.decision === 'approve' ? (
                <Alert severity="warning" icon={<CheckIcon />}>
                  They will not be able to sign in again. Their leave, timesheets and payslips
                  are kept — nothing is deleted, and the account can be reactivated from the
                  Users tab.
                </Alert>
              ) : (
                <Alert severity="info">The employee stays active and HR is told why.</Alert>
              )}

              <TextField
                label="Note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                multiline
                minRows={2}
                required={dialog.decision === 'reject'}
                error={Boolean(note) && rejectTooShort}
                helperText={
                  dialog.decision === 'reject'
                    ? 'Required — HR asked for this and needs an answer.'
                    : 'Optional. HR sees it.'
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
            color={dialog?.decision === 'approve' ? 'error' : 'primary'}
            onClick={submit}
            disabled={busy || rejectTooShort}
          >
            {busy
              ? 'Saving...'
              : dialog?.decision === 'approve'
                ? 'Deactivate account'
                : 'Decline'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
