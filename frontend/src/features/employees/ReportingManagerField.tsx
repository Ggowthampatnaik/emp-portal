/**
 * "Reporting manager" on an employee record, with a Change button for HR and
 * administrators (`employee.edit`) - the same place, and the same shape, as
 * Manage on Direct reports below it, rather than only inside the page's Edit
 * form.
 *
 * Saves just this one field. The server refuses someone reporting to
 * themselves, or to anyone below them in the reporting line (a loop), and the
 * reason is shown in the dialog.
 */

import EditIcon from '@mui/icons-material/Edit';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState } from 'react';

import { useAppDispatch } from '@/app/hooks';
import ClosableDialogTitle from '@/components/common/ClosableDialogTitle';
import EmployeePicker from '@/components/common/EmployeePicker';
import { ErrorAlert } from '@/components/common/Feedback';
import { showToast } from '@/features/ui/uiSlice';
import { useApiAction } from '@/hooks/useApiResource';
import { employeesApi } from '@/services/api/services';
import type { EmployeeDetail } from '@/types/domain';

interface Props {
  employee: EmployeeDetail;
  /** HR and administrators: may change who this person reports to. */
  canManage: boolean;
  /** The saved record, so the page shows the new manager straight away. */
  onChanged: (employee: EmployeeDetail) => void;
}

export default function ReportingManagerField({ employee, canManage, onChanged }: Props) {
  const dispatch = useAppDispatch();
  const save = useApiAction(employeesApi.update);
  const [open, setOpen] = useState(false);
  const [managerId, setManagerId] = useState<number | null>(employee.reporting_manager);

  const startChanging = () => {
    setManagerId(employee.reporting_manager);
    save.clearError();
    setOpen(true);
  };

  const handleSave = async () => {
    if (managerId === employee.reporting_manager) {
      setOpen(false);
      return;
    }
    const saved = await save.run(employee.id, { reporting_manager: managerId });
    if (saved) {
      onChanged(saved);
      setOpen(false);
      dispatch(
        showToast(
          saved.reporting_manager_name
            ? `${saved.full_name} now reports to ${saved.reporting_manager_name}.`
            : `${saved.full_name} no longer has a reporting manager.`,
          'success',
        ),
      );
    }
  };

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="caption" color="text.secondary">
          Reporting manager
        </Typography>
        {canManage && (
          <Button size="small" startIcon={<EditIcon />} onClick={startChanging}>
            Change
          </Button>
        )}
      </Stack>
      <Typography variant="body2">{employee.reporting_manager_name || '-'}</Typography>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <ClosableDialogTitle onClose={() => setOpen(false)}>
          Reporting manager of {employee.full_name}
        </ClosableDialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {/* A refusal about the manager itself (a loop, themselves) is said
                under the picker in words; anything else goes in the alert. */}
            {save.error && !save.fieldErrors.reporting_manager && (
              <ErrorAlert error={save.error} />
            )}
            <EmployeePicker
              label="Reporting manager"
              value={managerId}
              onChange={(id) => {
                setManagerId(id);
                save.clearError();
              }}
              error={Boolean(save.fieldErrors.reporting_manager)}
              helperText={
                save.fieldErrors.reporting_manager ??
                'Search by name, employee ID or email. Clear it for nobody.'
              }
              size="small"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={save.busy}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleSave} disabled={save.busy}>
            {save.busy ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
