/**
 * Put somebody on a project.
 *
 * The employee field asks the server as you type rather than listing the
 * first hundred active staff: on a project page you already know who you
 * mean, and a dropdown that quietly stops at a hundred people is wrong in
 * exactly the company where it matters.
 */

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useState } from 'react';

import { useAppDispatch } from '@/app/hooks';
import ClosableDialogTitle from '@/components/common/ClosableDialogTitle';
import EmployeePicker from '@/components/common/EmployeePicker';
import { showToast } from '@/features/ui/uiSlice';
import { PROJECT_ROLES } from '@/features/projects/roles';
import { useApiAction } from '@/hooks/useApiResource';
import { projectsApi } from '@/services/api/services';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function AddTeamMemberDialog({
  projectId,
  onClose,
  onSaved,
}: {
  projectId: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dispatch = useAppDispatch();
  const [form, setForm] = useState<{
    employee: number | null;
    role_in_project: string;
    joined_on: string;
  }>({
    employee: null,
    role_in_project: 'developer',
    joined_on: todayIso(),
  });

  const add = useApiAction(projectsApi.addMember);

  const handleSubmit = async () => {
    if (form.employee === null) return;
    const saved = await add.run(projectId, { ...form, employee: form.employee });
    if (!saved) return;
    dispatch(showToast(`${saved.employee_name} added to the team.`, 'success'));
    onSaved();
  };

  return (
    <Dialog open onClose={add.busy ? undefined : onClose} fullWidth maxWidth="sm">
      <ClosableDialogTitle onClose={onClose} disabled={add.busy}>
        Add team member
      </ClosableDialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {add.error && !Object.keys(add.fieldErrors).length && (
            <Alert severity="error">{add.error.message}</Alert>
          )}

          <EmployeePicker
            value={form.employee}
            onChange={(employeeId) => setForm({ ...form, employee: employeeId })}
            error={Boolean(add.fieldErrors.employee)}
            helperText={add.fieldErrors.employee ?? ' '}
            disabled={add.busy}
            required
          />

          <TextField
            select
            label="Role on project"
            value={form.role_in_project}
            onChange={(event) => setForm({ ...form, role_in_project: event.target.value })}
            disabled={add.busy}
          >
            {PROJECT_ROLES.map((role) => (
              <MenuItem key={role.value} value={role.value}>
                {role.label}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            label="Joined on"
            type="date"
            value={form.joined_on}
            onChange={(event) => setForm({ ...form, joined_on: event.target.value })}
            slotProps={{ inputLabel: { shrink: true } }}
            error={Boolean(add.fieldErrors.joined_on)}
            helperText={add.fieldErrors.joined_on ?? 'When they started on this project.'}
            disabled={add.busy}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={add.busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={add.busy || form.employee === null}
        >
          {add.busy ? 'Saving...' : 'Add'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
