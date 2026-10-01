/** Departments and designations administration. */

import AddIcon from '@mui/icons-material/Add';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import Link from '@mui/material/Link';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import { useCallback, useState } from 'react';

import { useAppDispatch } from '@/app/hooks';
import { Link as RouterLink } from 'react-router-dom';

import { EmptyState, ErrorAlert, TableSkeleton } from '@/components/common/Feedback';
import PageHeader from '@/components/common/PageHeader';
import { showToast } from '@/features/ui/uiSlice';
import { usePermissions } from '@/hooks/usePermissions';
import { useApiAction, useApiResource } from '@/hooks/useApiResource';
import { employeesApi } from '@/services/api/services';
import ClosableDialogTitle from '@/components/common/ClosableDialogTitle';

export default function DepartmentsPage() {
  const [tab, setTab] = useState(0);
  const { can } = usePermissions();
  const mayManage = can('department.manage');

  return (
    <>
      <PageHeader
        title="Organization structure"
        subtitle="Departments and job titles used across the portal"
      />
      <Card>
        <Tabs value={tab} onChange={(_, next) => setTab(next)} sx={{ px: 2 }}>
          <Tab label="Departments" />
          <Tab label="Designations" />
        </Tabs>
        {tab === 0 ? (
          <DepartmentsTab mayManage={mayManage} />
        ) : (
          <DesignationsTab mayManage={mayManage} />
        )}
      </Card>
    </>
  );
}

function DepartmentsTab({ mayManage }: { mayManage: boolean }) {
  const dispatch = useAppDispatch();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', description: '' });

  const { data, loading, error, reload } = useApiResource(
    useCallback(() => employeesApi.departments({ page_size: 100 }), []),
    [],
  );
  const create = useApiAction(employeesApi.createDepartment);
  const update = useApiAction(({ id, ...body }: { id: number; is_active: boolean }) =>
    employeesApi.updateDepartment(id, body),
  );

  // Departments are referenced by every employment record, so they are retired
  // rather than deleted - the same reasoning as account closure.
  const toggleActive = async (row: { id: number; name: string; is_active: boolean }) => {
    const saved = await update.run({ id: row.id, is_active: !row.is_active });
    if (saved) {
      dispatch(showToast(`${row.name} ${row.is_active ? 'retired' : 'reactivated'}.`, 'info'));
      void reload();
    }
  };

  const handleCreate = async () => {
    const saved = await create.run({
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      description: form.description,
    });
    if (saved) {
      dispatch(showToast(`Department ${saved.name} created.`, 'success'));
      setForm({ code: '', name: '', description: '' });
      setOpen(false);
      void reload();
    }
  };

  return (
    <>
      {mayManage && (
        <Stack direction="row" justifyContent="flex-end" sx={{ p: 2 }}>
          <Button startIcon={<AddIcon />} variant="contained" onClick={() => setOpen(true)}>
            Add department
          </Button>
        </Stack>
      )}
      {error && <ErrorAlert error={error} onRetry={reload} />}
      {loading ? (
        <TableSkeleton columns={4} />
      ) : !data?.results.length ? (
        <EmptyState title="No departments yet" />
      ) : (
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Code</TableCell>
                <TableCell>Name</TableCell>
                <TableCell>Head</TableCell>
                <TableCell align="right">Employees</TableCell>
                <TableCell>Status</TableCell>
                {mayManage && <TableCell align="right">Actions</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {data.results.map((row) => (
                <TableRow key={row.id} hover>
                  <TableCell>{row.code}</TableCell>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>{row.head_name ?? '-'}</TableCell>
                  <TableCell align="right">
                    {/* The count is the question "who are they?" waiting to be
                        asked, so it answers it. */}
                    {row.employee_count > 0 ? (
                      <Link
                        component={RouterLink}
                        to={`/employees?department=${row.id}`}
                        underline="hover"
                      >
                        {row.employee_count}
                      </Link>
                    ) : (
                      row.employee_count
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={row.is_active ? 'Active' : 'Inactive'}
                      color={row.is_active ? 'success' : 'default'}
                      variant={row.is_active ? 'filled' : 'outlined'}
                    />
                  </TableCell>
                  {mayManage && (
                    <TableCell align="right">
                      <Button
                        size="small"
                        disabled={update.busy}
                        onClick={() => void toggleActive(row)}
                      >
                        {row.is_active ? 'Retire' : 'Reactivate'}
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <ClosableDialogTitle onClose={() => setOpen(false)}>Add department</ClosableDialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="Code"
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
              error={Boolean(create.fieldErrors.code)}
              helperText={create.fieldErrors.code ?? 'Short identifier, e.g. ENG'}
              required
            />
            <TextField
              label="Name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              error={Boolean(create.fieldErrors.name)}
              helperText={create.fieldErrors.name ?? ' '}
              required
            />
            <TextField
              label="Description"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              multiline
              minRows={2}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={create.busy}>
            {create.busy ? 'Saving...' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function DesignationsTab({ mayManage }: { mayManage: boolean }) {
  const dispatch = useAppDispatch();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', level: '1' });

  const { data, loading, error, reload } = useApiResource(
    useCallback(() => employeesApi.designations({ page_size: 100 }), []),
    [],
  );
  const create = useApiAction(employeesApi.createDesignation);

  const handleCreate = async () => {
    const saved = await create.run({
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      level: Number(form.level),
    });
    if (saved) {
      dispatch(showToast(`Designation ${saved.name} created.`, 'success'));
      setForm({ code: '', name: '', level: '1' });
      setOpen(false);
      void reload();
    }
  };

  return (
    <>
      {mayManage && (
        <Stack direction="row" justifyContent="flex-end" sx={{ p: 2 }}>
          <Button startIcon={<AddIcon />} variant="contained" onClick={() => setOpen(true)}>
            Add designation
          </Button>
        </Stack>
      )}
      {error && <ErrorAlert error={error} onRetry={reload} />}
      {loading ? (
        <TableSkeleton columns={4} />
      ) : !data?.results.length ? (
        <EmptyState title="No designations yet" />
      ) : (
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Code</TableCell>
                <TableCell>Name</TableCell>
                <TableCell align="right">Level</TableCell>
                <TableCell align="right">Employees</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.results.map((row) => (
                <TableRow key={row.id} hover>
                  <TableCell>{row.code}</TableCell>
                  <TableCell>{row.name}</TableCell>
                  <TableCell align="right">{row.level}</TableCell>
                  <TableCell align="right">{row.employee_count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <ClosableDialogTitle onClose={() => setOpen(false)}>
          Add designation
        </ClosableDialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="Code"
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
              error={Boolean(create.fieldErrors.code)}
              helperText={create.fieldErrors.code ?? 'e.g. SSE'}
              required
            />
            <TextField
              label="Name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              error={Boolean(create.fieldErrors.name)}
              helperText={create.fieldErrors.name ?? ' '}
              required
            />
            <TextField
              label="Level"
              type="number"
              value={form.level}
              onChange={(event) => setForm({ ...form, level: event.target.value })}
              helperText="1 = most junior; used for sorting and reports."
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={create.busy}>
            {create.busy ? 'Saving...' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
