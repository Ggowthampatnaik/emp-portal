/**
 * "Direct reports" on an employee record: who reports to this person, by name
 * and - for HR and administrators (`employee.edit`) - a way to change it.
 *
 * Direct reports are not a list kept anywhere: they are everyone whose
 * reporting manager is this person. Managing them sets or clears that field on
 * each of them, in one request, so a change lands whole or not at all
 * (`PUT /employees/{id}/direct-reports/`). The server refuses a loop - someone
 * above this person in the reporting line cannot also report to them.
 */

import EditIcon from '@mui/icons-material/Edit';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useCallback, useState } from 'react';

import { useAppDispatch } from '@/app/hooks';
import ClosableDialogTitle from '@/components/common/ClosableDialogTitle';
import EmployeePicker from '@/components/common/EmployeePicker';
import { ErrorAlert } from '@/components/common/Feedback';
import { showToast } from '@/features/ui/uiSlice';
import { useApiAction, useApiResource } from '@/hooks/useApiResource';
import { employeesApi } from '@/services/api/services';
import type { EmployeeListItem } from '@/types/domain';

interface Props {
  employeeId: number;
  employeeName: string;
  /** HR and administrators: may change who reports to this person. */
  canManage: boolean;
  /** Told the new count, so the rest of the page can follow. */
  onChanged?: (count: number) => void;
}

type Person = Pick<EmployeeListItem, 'id' | 'full_name' | 'employee_code' | 'designation_name'>;

const label = (person: Person) =>
  person.designation_name
    ? `${person.full_name} · ${person.designation_name}`
    : person.full_name;

export default function DirectReportsField({
  employeeId,
  employeeName,
  canManage,
  onChanged,
}: Props) {
  const dispatch = useAppDispatch();
  const reports = useApiResource(
    useCallback(() => employeesApi.directReports(employeeId), [employeeId]),
    [employeeId],
  );
  const save = useApiAction(employeesApi.setDirectReports);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Person[]>([]);

  const people = reports.data ?? [];

  const startManaging = () => {
    setDraft(people);
    save.clearError();
    setOpen(true);
  };

  const add = (person: EmployeeListItem | null) => {
    if (!person || person.id === employeeId) return;
    setDraft((current) =>
      current.some((row) => row.id === person.id) ? current : [...current, person],
    );
  };

  const handleSave = async () => {
    const saved = await save.run(
      employeeId,
      draft.map((person) => person.id),
    );
    if (saved) {
      reports.setData(saved);
      onChanged?.(saved.length);
      setOpen(false);
      dispatch(showToast('Direct reports updated.', 'success'));
    }
  };

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="caption" color="text.secondary">
          Direct reports{people.length ? ` (${people.length})` : ''}
        </Typography>
        {canManage && (
          <Button size="small" startIcon={<EditIcon />} onClick={startManaging}>
            Manage
          </Button>
        )}
      </Stack>

      {reports.error ? (
        <Typography variant="body2" color="text.secondary">
          Could not load the list.
        </Typography>
      ) : people.length === 0 ? (
        <Typography variant="body2">{reports.loading ? '...' : '-'}</Typography>
      ) : (
        <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mt: 0.5 }}>
          {/* Names only, and not links: the record says who reports here, it
              is not a way into their records. */}
          {people.map((person) => (
            <Chip key={person.id} size="small" label={person.full_name} />
          ))}
        </Stack>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <ClosableDialogTitle onClose={() => setOpen(false)}>
          Direct reports of {employeeName}
        </ClosableDialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {/* The alert already carries the server's reason - a loop, an unknown
                person - so it is said once, here. */}
            {save.error && <ErrorAlert error={save.error} />}

            <EmployeePicker
              value={null}
              onChange={(_, person) => add(person)}
              label="Add a direct report"
              helperText="Search by name, employee ID or email. Someone who reports elsewhere moves here."
              size="small"
            />

            {draft.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Nobody reports to {employeeName}.
              </Typography>
            ) : (
              <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                {draft.map((person) => (
                  <Chip
                    key={person.id}
                    label={label(person)}
                    onDelete={() =>
                      setDraft((current) => current.filter((row) => row.id !== person.id))
                    }
                  />
                ))}
              </Stack>
            )}
            <Typography variant="caption" color="text.secondary">
              Anyone removed here is left without a reporting manager until one is assigned.
            </Typography>
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
