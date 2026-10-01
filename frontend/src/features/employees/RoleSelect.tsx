/**
 * The Role column's inline dropdown: pick roles straight in the table row.
 *
 * Multi-select, because roles are - Vikram is an employee *and* a manager,
 * and a single-choice dropdown would silently strip one to grant the other.
 * The save happens when the dropdown closes, not on every tick, so granting
 * two roles is one request and one toast rather than a race of two.
 */

import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import { useState } from 'react';

import { useAppDispatch } from '@/app/hooks';
import { showToast } from '@/features/ui/uiSlice';
import { useApiAction } from '@/hooks/useApiResource';
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

export default function RoleSelect({
  employee,
  onSaved,
}: {
  employee: EmployeeListItem;
  onSaved: () => void;
}) {
  const dispatch = useAppDispatch();
  const [selected, setSelected] = useState<RoleSlug[]>(employee.roles as RoleSlug[]);
  const save = useApiAction(adminApi.setRoles);

  const commit = async () => {
    const before = [...employee.roles].sort().join(',');
    const after = [...selected].sort().join(',');
    if (after === before) return; // closed without changing anything
    if (selected.length === 0) {
      setSelected(employee.roles as RoleSlug[]); // an account with no role cannot sign in
      dispatch(showToast('An account needs at least one role.', 'warning'));
      return;
    }
    const updated = await save.run(employee.user_id, selected);
    if (updated) {
      dispatch(showToast(`Roles updated for ${employee.full_name}.`, 'success'));
      onSaved();
    } else {
      setSelected(employee.roles as RoleSlug[]); // the server said no - show the truth
    }
  };

  return (
    <Select
      multiple
      size="small"
      variant="outlined"
      value={selected}
      onChange={(event) => setSelected(event.target.value as RoleSlug[])}
      onClose={() => void commit()}
      disabled={save.busy}
      renderValue={(value) => value.join(', ')}
      endAdornment={save.busy ? <CircularProgress size={14} sx={{ mr: 2 }} /> : null}
      sx={{ minWidth: 170, fontSize: 13 }}
      inputProps={{ 'aria-label': `Roles for ${employee.full_name}` }}
    >
      {ROLE_ORDER.map((role) => (
        <MenuItem key={role} value={role} dense>
          <Checkbox size="small" checked={selected.includes(role)} />
          <ListItemText primary={role} />
        </MenuItem>
      ))}
    </Select>
  );
}
