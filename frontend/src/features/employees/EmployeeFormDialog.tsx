/** Onboarding dialog: creates the portal account and the employment record. */

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useState } from 'react';

import { useAppDispatch } from '@/app/hooks';
import PhoneNumberInput from '@/components/common/PhoneNumberInput';
import { showToast } from '@/features/ui/uiSlice';
import { useApiAction, useApiResource } from '@/hooks/useApiResource';
import { employeesApi } from '@/services/api/services';
import { ROLES, type RoleSlug } from '@/types/auth';
import { todayIso } from '@/utils/date';
import { describeMissing, meetsPasswordRules, PASSWORD_HINT } from '@/utils/passwordRules';
import { phoneProblem } from '@/utils/phone';
import ClosableDialogTitle from '@/components/common/ClosableDialogTitle';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const ASSIGNABLE_ROLES: { value: RoleSlug; label: string }[] = [
  { value: ROLES.EMPLOYEE, label: 'Employee only' },
  { value: ROLES.MANAGER, label: 'Employee + Manager' },
  { value: ROLES.HR, label: 'Employee + HR' },
  { value: ROLES.ADMIN, label: 'Employee + Admin' },
];

const EMPTY = {
  employee_code: '',
  first_name: '',
  last_name: '',
  email: '',
  temporary_password: '',
  department: '',
  designation: '',
  reporting_manager: '',
  date_of_joining: todayIso(),
  work_location: '',
  phone: '',
};

export default function EmployeeFormDialog({ open, onClose, onSaved }: Props) {
  const dispatch = useAppDispatch();
  const [form, setForm] = useState({ ...EMPTY });
  const [role, setRole] = useState<RoleSlug>(ROLES.EMPLOYEE);

  const departments = useApiResource(
    useCallback(() => employeesApi.departments({ page_size: 100 }), []),
    [],
  );
  const designations = useApiResource(
    useCallback(() => employeesApi.designations({ page_size: 100 }), []),
    [],
  );
  const managers = useApiResource(
    useCallback(() => employeesApi.list({ page_size: 100, employment_status: 'active' }), []),
    [],
  );

  const action = useApiAction(employeesApi.create);
  // Set once Create is pressed, so an untouched empty password is flagged then
  // rather than the moment the form opens.
  const [tried, setTried] = useState(false);

  // The same rule as Set your password: what is still missing, as it is typed.
  const password = form.temporary_password;
  const passwordProblem =
    password || tried
      ? password
        ? describeMissing(password)
        : 'Enter a temporary password.'
      : null;

  const set = (field: keyof typeof EMPTY) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [field]: event.target.value }));

  const handleSubmit = async () => {
    setTried(true);
    // A weak password or a bad number is refused by the server too; stopping
    // here just saves the round trip and keeps the message beside the field.
    if (!meetsPasswordRules(password) || phoneProblem(form.phone, true)) return;

    const payload: Record<string, unknown> = {
      ...form,
      employee_code: form.employee_code.trim().toUpperCase(),
      email: form.email.trim().toLowerCase(),
      roles: role === ROLES.EMPLOYEE ? [ROLES.EMPLOYEE] : [ROLES.EMPLOYEE, role],
    };
    // Blank selects must be omitted, not sent as empty strings.
    for (const key of ['department', 'designation', 'reporting_manager'] as const) {
      if (!form[key]) delete payload[key];
    }
    if (!form.phone) delete payload.phone;
    if (!form.work_location) delete payload.work_location;

    const created = await action.run(payload);
    if (created) {
      dispatch(showToast(`${created.full_name} onboarded.`, 'success'));
      setForm({ ...EMPTY });
      setRole(ROLES.EMPLOYEE);
      setTried(false);
      onSaved();
    }
  };

  const fieldProps = (field: string) => ({
    error: Boolean(action.fieldErrors[field]),
    helperText: action.fieldErrors[field] ?? ' ',
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <ClosableDialogTitle onClose={onClose}>Add employee</ClosableDialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {action.error && !Object.keys(action.fieldErrors).length && (
            <Alert severity="error" onClose={action.clearError}>
              {action.error.message}
            </Alert>
          )}

          <Typography variant="subtitle2" color="text.secondary">
            Identity
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Employee ID"
              value={form.employee_code}
              onChange={set('employee_code')}
              placeholder="TRG0042"
              required
              fullWidth
              {...fieldProps('employee_code')}
            />
            <TextField
              label="Work email"
              type="email"
              value={form.email}
              onChange={set('email')}
              required
              fullWidth
              {...fieldProps('email')}
            />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="First name"
              value={form.first_name}
              onChange={set('first_name')}
              required
              fullWidth
              {...fieldProps('first_name')}
            />
            <TextField
              label="Last name"
              value={form.last_name}
              onChange={set('last_name')}
              required
              fullWidth
              {...fieldProps('last_name')}
            />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Temporary password"
              value={form.temporary_password}
              onChange={set('temporary_password')}
              required
              fullWidth
              {...fieldProps('temporary_password')}
              error={Boolean(action.fieldErrors.temporary_password || passwordProblem)}
              helperText={
                action.fieldErrors.temporary_password ??
                passwordProblem ??
                `${PASSWORD_HINT} The employee must change it at first sign-in.`
              }
            />
            <TextField
              select
              label="Roles"
              value={role}
              onChange={(event) => setRole(event.target.value as RoleSlug)}
              fullWidth
              helperText=" "
            >
              {ASSIGNABLE_ROLES.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          <Typography variant="subtitle2" color="text.secondary">
            Employment
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              select
              label="Department"
              value={form.department}
              onChange={set('department')}
              fullWidth
              {...fieldProps('department')}
            >
              <MenuItem value="">Not assigned</MenuItem>
              {(departments.data?.results ?? []).map((row) => (
                <MenuItem key={row.id} value={String(row.id)}>
                  {row.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Designation"
              value={form.designation}
              onChange={set('designation')}
              fullWidth
              {...fieldProps('designation')}
            >
              <MenuItem value="">Not assigned</MenuItem>
              {(designations.data?.results ?? []).map((row) => (
                <MenuItem key={row.id} value={String(row.id)}>
                  {row.name}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              select
              label="Reporting manager"
              value={form.reporting_manager}
              onChange={set('reporting_manager')}
              fullWidth
              {...fieldProps('reporting_manager')}
            >
              <MenuItem value="">No manager</MenuItem>
              {(managers.data?.results ?? []).map((row) => (
                <MenuItem key={row.id} value={String(row.id)}>
                  {row.full_name} ({row.employee_code})
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Date of joining"
              type="date"
              value={form.date_of_joining}
              onChange={set('date_of_joining')}
              required
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
              {...fieldProps('date_of_joining')}
            />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Work location"
              value={form.work_location}
              onChange={set('work_location')}
              fullWidth
              {...fieldProps('work_location')}
            />
            <Box sx={{ width: '100%' }}>
              <PhoneNumberInput
                label="Phone"
                value={form.phone}
                onChange={(phone) => setForm((prev) => ({ ...prev, phone }))}
                mobile
                serverError={action.fieldErrors.phone}
                helperText="Mobile number, without the country code."
              />
            </Box>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={action.busy}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={action.busy}>
          {action.busy ? 'Saving...' : 'Create employee'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
