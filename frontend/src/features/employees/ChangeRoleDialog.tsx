/**
 * Change what an employee's portal account may do.
 *
 * Lives on the Employees page - "make Vikram a manager" is something you
 * decide looking at a person, not at an accounts table. Saves through the
 * same admin endpoint the backend has always enforced with
 * `admin.manage_roles`, so this dialog appearing here grants nobody anything.
 */

import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { useState } from 'react';

import { useAppDispatch } from '@/app/hooks';
import ClosableDialogTitle from '@/components/common/ClosableDialogTitle';
import { ErrorAlert } from '@/components/common/Feedback';
import { showToast } from '@/features/ui/uiSlice';
import { useApiAction } from '@/hooks/useApiResource';
import { usePermissions } from '@/hooks/usePermissions';
import { adminApi } from '@/services/api/services';
import { ROLES, type RoleSlug } from '@/types/auth';
import type { EmployeeListItem } from '@/types/domain';

const ROLE_ORDER: RoleSlug[] = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.HR,
  ROLES.MANAGER,
  ROLES.FINANCE,
  ROLES.EMPLOYEE,
];

export default function ChangeRoleDialog({
  employee,
  onClose,
  onSaved,
}: {
  employee: EmployeeListItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dispatch = useAppDispatch();
  const { isSuperAdmin } = usePermissions();
  const [selected, setSelected] = useState<RoleSlug[]>(employee.roles as RoleSlug[]);
  const save = useApiAction(adminApi.setRoles);
  // Only a Super Admin may grant or revoke Super Admin; the server refuses it
  // for anyone else. Admins still see the switch when the person already
  // holds the role, locked, so the dialog tells the truth about the account.
  const holdsSuper = employee.roles.includes(ROLES.SUPER_ADMIN);
  const roles = ROLE_ORDER.filter(
    (role) => role !== ROLES.SUPER_ADMIN || isSuperAdmin || holdsSuper,
  );

  const handleSave = async () => {
    const updated = await save.run(employee.user_id, selected);
    if (!updated) return;
    dispatch(showToast(`Roles updated for ${employee.full_name}.`, 'success'));
    onSaved();
  };

  return (
    <Dialog open onClose={save.busy ? undefined : onClose} fullWidth maxWidth="xs">
      <ClosableDialogTitle onClose={onClose} disabled={save.busy}>
        Change role for {employee.full_name}
      </ClosableDialogTitle>
      <DialogContent>
        {save.error && <ErrorAlert error={save.error} />}
        <Stack sx={{ pt: 1 }}>
          {roles.map((role) => (
            <FormControlLabel
              key={role}
              control={
                <Switch
                  checked={selected.includes(role)}
                  disabled={save.busy || (role === ROLES.SUPER_ADMIN && !isSuperAdmin)}
                  onChange={(event) =>
                    setSelected((prev) =>
                      event.target.checked
                        ? [...prev, role]
                        : prev.filter((entry) => entry !== role),
                    )
                  }
                />
              }
              label={role}
            />
          ))}
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
            Takes effect on their next request - the server checks these roles, not the sidebar.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={save.busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={save.busy || selected.length === 0}
        >
          {save.busy ? 'Saving...' : 'Save roles'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
