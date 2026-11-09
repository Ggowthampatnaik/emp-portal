/**
 * Allocate someone's capacity to a project.
 *
 * Separate from adding them to the team because the two are separate records:
 * you can be on a project without a booked percentage, and the server refuses
 * to take anyone past 100% across everything they are on. That refusal is the
 * one worth surfacing clearly, so its message is shown against the field.
 *
 * Only this project's team can be chosen, so someone joins the team first.
 * Whoever already has an allocation stays listed but cannot be picked: a second
 * one would count them twice.
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
import { showToast } from '@/features/ui/uiSlice';
import { useApiAction } from '@/hooks/useApiResource';
import { projectsApi } from '@/services/api/services';
import type { ProjectAllocation, ProjectMember } from '@/types/domain';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function AddAllocationDialog({
  projectId,
  members,
  allocations,
  onClose,
  onSaved,
}: {
  projectId: number;
  /** The team as it stands now. */
  members: ProjectMember[];
  /** The team's active allocations. */
  allocations: ProjectAllocation[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const dispatch = useAppDispatch();
  const [form, setForm] = useState<{
    employee: number | null;
    allocation_percentage: string;
    start_date: string;
  }>({
    employee: null,
    allocation_percentage: '50',
    start_date: todayIso(),
  });

  const add = useApiAction(projectsApi.addAllocation);

  const allocationOf = (employeeId: number) =>
    allocations.find((allocation) => allocation.employee === employeeId);
  const everyoneAllocated = members.every((member) => allocationOf(member.employee));

  const handleSubmit = async () => {
    if (form.employee === null) return;
    const saved = await add.run(projectId, { ...form, employee: form.employee });
    if (!saved) return;
    dispatch(showToast(`${saved.employee_name} allocated.`, 'success'));
    onSaved();
  };

  return (
    <Dialog open onClose={add.busy ? undefined : onClose} fullWidth maxWidth="sm">
      <ClosableDialogTitle onClose={onClose} disabled={add.busy}>
        Allocate capacity
      </ClosableDialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {add.error && !Object.keys(add.fieldErrors).length && (
            <Alert severity="error">{add.error.message}</Alert>
          )}

          {everyoneAllocated && (
            <Alert severity="info">
              {members.length
                ? 'Everyone on this team already has an allocation.'
                : 'Nobody is on this team yet. Add a member first.'}
            </Alert>
          )}

          <TextField
            select
            label="Team member"
            value={form.employee ?? ''}
            onChange={(event) => setForm({ ...form, employee: Number(event.target.value) })}
            error={Boolean(add.fieldErrors.employee)}
            helperText={add.fieldErrors.employee ?? 'Only people on this project are listed.'}
            disabled={add.busy || everyoneAllocated}
            required
          >
            {members.map((member) => {
              const existing = allocationOf(member.employee);
              return (
                <MenuItem key={member.id} value={member.employee} disabled={Boolean(existing)}>
                  {member.employee_name} ({member.employee_code})
                  {existing
                    ? ` - already ${Number(existing.allocation_percentage).toFixed(0)}%`
                    : ''}
                </MenuItem>
              );
            })}
          </TextField>

          <TextField
            label="Allocation %"
            type="number"
            value={form.allocation_percentage}
            onChange={(event) =>
              setForm({ ...form, allocation_percentage: event.target.value })
            }
            error={Boolean(add.fieldErrors.allocation_percentage)}
            helperText={
              add.fieldErrors.allocation_percentage ??
              'An employee cannot exceed 100% across all their projects.'
            }
            disabled={add.busy}
          />

          <TextField
            label="Start date"
            type="date"
            value={form.start_date}
            onChange={(event) => setForm({ ...form, start_date: event.target.value })}
            slotProps={{ inputLabel: { shrink: true } }}
            error={Boolean(add.fieldErrors.start_date)}
            helperText={add.fieldErrors.start_date ?? ' '}
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
          {add.busy ? 'Saving...' : 'Allocate'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
