/**
 * Salary bank account, on the profile page.
 *
 * Decision D9 governs what is shown: the employee and HR may read and write it,
 * reporting managers may not, and the full account number is returned only to
 * the owner. HR therefore sees a masked number even on a record they can edit —
 * that is deliberate, so a support screen can never be used to read an account
 * number out of the system.
 *
 * It fetches and saves on its own rather than joining the page's edit mode: the
 * data lives at its own endpoint and needs its own permission check.
 */

import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useState } from 'react';

import { useAppDispatch } from '@/app/hooks';
import { ErrorAlert } from '@/components/common/Feedback';
import SectionCard from '@/components/common/SectionCard';
import { showToast } from '@/features/ui/uiSlice';
import { useApiAction, useApiResource } from '@/hooks/useApiResource';
import { employeesApi } from '@/services/api/services';
import type { BankAccountPayload } from '@/types/domain';

const ACCOUNT_TYPES = [
  { value: 'salary', label: 'Salary' },
  { value: 'savings', label: 'Savings' },
  { value: 'current', label: 'Current' },
];

const EMPTY: BankAccountPayload = {
  account_holder_name: '',
  bank_name: '',
  branch_name: '',
  account_number: '',
  ifsc_code: '',
  account_type: 'salary',
};

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2">{value || '-'}</Typography>
    </Box>
  );
}

export default function BankDetailsCard({
  employeeId,
  employeeName,
  isOwner,
  canManage,
}: {
  employeeId: number;
  employeeName: string;
  /** The signed-in user is looking at their own record. */
  isOwner: boolean;
  /** Holds `bank.manage` — HR. */
  canManage: boolean;
}) {
  const dispatch = useAppDispatch();
  const mayTouch = isOwner || canManage;

  const { data, loading, error, reload, setData } = useApiResource(
    useCallback(
      () => (mayTouch ? employeesApi.bankAccount(employeeId) : Promise.resolve(null)),
      [employeeId, mayTouch],
    ),
    [employeeId, mayTouch],
  );

  const save = useApiAction(employeesApi.saveBankAccount);
  const remove = useApiAction(employeesApi.deleteBankAccount);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<BankAccountPayload>(EMPTY);

  useEffect(() => {
    if (!data) return;
    setForm({
      account_holder_name: data.account_holder_name,
      bank_name: data.bank_name,
      branch_name: data.branch_name,
      // Only the owner gets the number back, so HR always retypes it in full.
      account_number: data.account_number ?? '',
      ifsc_code: data.ifsc_code,
      account_type: data.account_type,
    });
  }, [data]);

  if (!mayTouch) return null;

  // A record with no account yet answers 404 — that is "not recorded", not a failure.
  const missing = error?.status === 404;
  const set = (field: keyof BankAccountPayload) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [field]: event.target.value }));

  const startEditing = () => {
    if (missing) setForm({ ...EMPTY, account_holder_name: employeeName });
    save.clearError();
    setEditing(true);
  };

  const handleSave = async () => {
    const saved = await save.run(employeeId, {
      ...form,
      ifsc_code: form.ifsc_code.toUpperCase().trim(),
      account_number: form.account_number.trim(),
    });
    if (saved) {
      setData(saved);
      setEditing(false);
      dispatch(showToast('Bank details saved.', 'success'));
    }
  };

  const handleRemove = async () => {
    await remove.run(employeeId);
    setData(null);
    setEditing(false);
    void reload();
    dispatch(showToast('Bank details removed.', 'info'));
  };

  return (
    <SectionCard
      title="Bank details"
      icon={<AccountBalanceIcon color="primary" />}
      subtitle="Where salary is paid."
      action={
        !editing ? (
          <Button size="small" startIcon={<EditIcon />} onClick={startEditing}>
            {missing ? 'Add' : 'Edit'}
          </Button>
        ) : undefined
      }
    >
      {loading && <LinearProgress sx={{ mb: 2 }} />}
      {error && !missing && <ErrorAlert error={error} onRetry={reload} />}
      {save.error && <ErrorAlert error={save.error} />}
      {remove.error && <ErrorAlert error={remove.error} />}

      {!isOwner && !editing && !missing && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Only the last four digits are shown. The full account number is visible to the
          employee alone.
        </Alert>
      )}

      {editing ? (
        <Stack spacing={2}>
          {!isOwner && (
            <Alert severity="warning">
              Saving replaces the whole account. Type the number in full — it is never read back
              out of the system.
            </Alert>
          )}
          <TextField
            label="Account holder name"
            value={form.account_holder_name}
            onChange={set('account_holder_name')}
            size="small"
            required
            error={Boolean(save.fieldErrors.account_holder_name)}
            helperText={save.fieldErrors.account_holder_name ?? 'Exactly as on the passbook.'}
          />
          <TextField
            label="Bank name"
            value={form.bank_name}
            onChange={set('bank_name')}
            size="small"
            required
            error={Boolean(save.fieldErrors.bank_name)}
            helperText={save.fieldErrors.bank_name ?? ' '}
          />
          <TextField
            label="Branch"
            value={form.branch_name}
            onChange={set('branch_name')}
            size="small"
            error={Boolean(save.fieldErrors.branch_name)}
            helperText={save.fieldErrors.branch_name ?? ' '}
          />
          <TextField
            label="Account number"
            value={form.account_number}
            onChange={set('account_number')}
            size="small"
            required
            error={Boolean(save.fieldErrors.account_number)}
            helperText={
              save.fieldErrors.account_number ?? 'Digits and letters only, no spaces.'
            }
          />
          <TextField
            label="IFSC code"
            value={form.ifsc_code}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, ifsc_code: event.target.value.toUpperCase() }))
            }
            size="small"
            required
            error={Boolean(save.fieldErrors.ifsc_code)}
            helperText={save.fieldErrors.ifsc_code ?? 'For example HDFC0001234.'}
            slotProps={{
              htmlInput: { maxLength: 11, style: { textTransform: 'uppercase' } },
            }}
          />
          <TextField
            select
            label="Account type"
            value={form.account_type}
            onChange={set('account_type')}
            size="small"
          >
            {ACCOUNT_TYPES.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>

          <Stack direction="row" spacing={1} justifyContent="flex-end">
            {!missing && (
              <Button
                color="error"
                startIcon={<DeleteOutlineIcon />}
                onClick={handleRemove}
                disabled={remove.busy || save.busy}
              >
                Remove
              </Button>
            )}
            <Box sx={{ flexGrow: 1 }} />
            <Button
              onClick={() => {
                setEditing(false);
                save.clearError();
              }}
              disabled={save.busy}
            >
              Cancel
            </Button>
            <Button
              variant="contained"
              startIcon={<SaveIcon />}
              onClick={handleSave}
              disabled={
                save.busy ||
                !form.account_holder_name ||
                !form.bank_name ||
                !form.account_number ||
                !form.ifsc_code
              }
            >
              {save.busy ? 'Saving...' : 'Save'}
            </Button>
          </Stack>
        </Stack>
      ) : missing ? (
        <Typography variant="body2" color="text.secondary">
          No account recorded yet. Salary cannot be paid until one is added.
        </Typography>
      ) : data ? (
        <Stack spacing={2}>
          <Field label="Account holder" value={data.account_holder_name} />
          <Field label="Bank" value={data.bank_name} />
          <Field label="Branch" value={data.branch_name} />
          <Field
            label="Account number"
            value={data.account_number ?? data.account_number_masked}
          />
          <Field label="IFSC code" value={data.ifsc_code} />
          <Field label="Account type" value={data.account_type_label} />
          {data.updated_by_name && (
            <Typography variant="caption" color="text.secondary">
              Last changed by {data.updated_by_name} on{' '}
              {new Date(data.updated_at).toLocaleDateString()}.
            </Typography>
          )}
        </Stack>
      ) : null}
    </SectionCard>
  );
}
