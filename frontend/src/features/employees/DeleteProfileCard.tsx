/**
 * The HR end of account closure, on the employee record.
 *
 * HR cannot close an account; it can only ask. That split is the whole point of
 * the feature, so this card is explicit about it — the button raises a request,
 * an administrator decides, and the wording never promises a deletion that will
 * not happen.
 *
 * Only shown to HR, only on someone else's record, and only while the account
 * is still active.
 */

import PersonRemoveIcon from '@mui/icons-material/PersonRemove';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useState } from 'react';

import { useAppDispatch } from '@/app/hooks';
import ClosableDialogTitle from '@/components/common/ClosableDialogTitle';
import { ErrorAlert } from '@/components/common/Feedback';
import SectionCard from '@/components/common/SectionCard';
import StatusChip from '@/components/common/StatusChip';
import { showToast } from '@/features/ui/uiSlice';
import { useApiAction, useApiResource } from '@/hooks/useApiResource';
import { employeesApi } from '@/services/api/services';

const MIN_REASON = 10;

export default function DeleteProfileCard({
  employeeId,
  employeeName,
  isActive,
  isOwnRecord,
  canRequest,
}: {
  employeeId: number;
  employeeName: string;
  /** Employment status is still active. */
  isActive: boolean;
  isOwnRecord: boolean;
  /** Holds `employee.request_deletion` — HR. */
  canRequest: boolean;
}) {
  const dispatch = useAppDispatch();
  const show = canRequest && !isOwnRecord;

  const { data, error, reload, setData } = useApiResource(
    useCallback(
      () => (show ? employeesApi.deletionRequest(employeeId) : Promise.resolve(null)),
      [employeeId, show],
    ),
    [employeeId, show],
  );

  const raise = useApiAction(employeesApi.requestDeletion);
  const withdraw = useApiAction(employeesApi.withdrawDeletion);

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  if (!show) return null;

  // No request has ever been raised for this person: a 404, not a failure.
  const none = error?.status === 404;
  const pending = data?.is_open ?? false;
  const tooShort = reason.trim().length < MIN_REASON;

  const handleRaise = async () => {
    const created = await raise.run(employeeId, reason.trim());
    if (created) {
      setData(created);
      setOpen(false);
      setReason('');
      dispatch(showToast('Sent to an administrator for a decision.', 'success'));
    }
  };

  const handleWithdraw = async () => {
    await withdraw.run(employeeId);
    setData(null);
    void reload();
    dispatch(showToast('Request withdrawn.', 'info'));
  };

  return (
    <SectionCard
      title="Account closure"
      icon={<PersonRemoveIcon color={pending ? 'warning' : 'error'} />}
      subtitle="Closing the account keeps the records and stops the sign-in."
      action={data && !none ? <StatusChip status={data.status} /> : undefined}
      sx={{ borderColor: pending ? 'warning.main' : undefined }}
    >
      {error && !none && <ErrorAlert error={error} onRetry={reload} />}
      {raise.error && <ErrorAlert error={raise.error} />}
      {withdraw.error && <ErrorAlert error={withdraw.error} />}

      {!isActive ? (
        <Typography variant="body2" color="text.secondary">
          This account is already inactive. {employeeName} cannot sign in; their records are
          kept.
        </Typography>
      ) : pending ? (
        <Stack spacing={2}>
          <Alert severity="warning">
            Waiting for an administrator. You raised this on{' '}
            {new Date(data!.requested_at).toLocaleDateString()}: “{data!.reason}”
          </Alert>
          <Stack direction="row" justifyContent="flex-end">
            <Button color="warning" onClick={handleWithdraw} disabled={withdraw.busy}>
              Withdraw request
            </Button>
          </Stack>
        </Stack>
      ) : (
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            Closing an account stops {employeeName} signing in. It does <strong>not</strong>{' '}
            delete anything — their leave, timesheets and payslips are kept, because the company
            still needs them.
          </Typography>
          {data && data.status === 'rejected' && (
            <Alert severity="info">
              A previous request was declined
              {data.decided_by_name ? ` by ${data.decided_by_name}` : ''}: “{data.decision_note}
              ”
            </Alert>
          )}
          <Stack direction="row" justifyContent="flex-end">
            <Button
              variant="outlined"
              color="error"
              startIcon={<PersonRemoveIcon />}
              onClick={() => {
                raise.clearError();
                setOpen(true);
              }}
            >
              Request closure
            </Button>
          </Stack>
        </Stack>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <ClosableDialogTitle onClose={() => setOpen(false)}>
          Request account closure
        </ClosableDialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="info">
              You are asking, not closing. An administrator decides, and it cannot be you.
            </Alert>
            <Typography variant="body2">
              {employeeName} will keep their records and lose their access, once approved.
            </Typography>
            <TextField
              label="Reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              multiline
              minRows={3}
              required
              autoFocus
              error={Boolean(reason) && tooShort}
              helperText={
                raise.fieldErrors.reason ??
                'An administrator has to judge this, so be specific — at least 10 characters.'
              }
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={raise.busy}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleRaise}
            disabled={raise.busy || tooShort}
          >
            {raise.busy ? 'Sending...' : 'Send request'}
          </Button>
        </DialogActions>
      </Dialog>
    </SectionCard>
  );
}
