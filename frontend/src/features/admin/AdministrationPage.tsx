/** Administration: user accounts, account closures and the audit log. */

import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Alert from '@mui/material/Alert';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useState } from 'react';

import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { EmptyState, ErrorAlert } from '@/components/common/Feedback';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import PageHeader from '@/components/common/PageHeader';
import AddUserDialog from '@/features/admin/AddUserDialog';
import AuditLogTab from '@/features/admin/AuditLogTab';
import DeletionRequestsTab from '@/features/admin/DeletionRequestsTab';
import { showToast } from '@/features/ui/uiSlice';
import { selectCurrentUser } from '@/features/auth/authSlice';
import { usePermissions } from '@/hooks/usePermissions';
import { useApiAction, useApiResource } from '@/hooks/useApiResource';
import MenuItem from '@mui/material/MenuItem';
import SkillPicker from '@/components/common/SkillPicker';
import { adminApi, employeesApi } from '@/services/api/services';
import ClosableDialogTitle from '@/components/common/ClosableDialogTitle';
import { ROLE_LABELS } from '@/types/auth';
import { formatDateTime } from '@/utils/date';
export default function AdministrationPage() {
  const { can } = usePermissions();
  const [tab, setTab] = useState(0);

  const tabs = [
    { label: 'Users', show: can('admin.manage_users'), render: () => <UsersTab /> },
    // Where HR's "Delete profile" requests are decided. Without this tab the
    // workflow dead-ends: HR can raise a closure from the employee record and
    // no administrator can ever see it, let alone approve or decline it.
    {
      label: 'Account closures',
      show: can('admin.manage_users'),
      render: () => <DeletionRequestsTab />,
    },
    // Read-only, and last: it is the page you open to answer "who changed
    // this", not one you work in. Gated on the same code the API checks, so
    // the tab is never offered to someone who would only get a 403 from it.
    {
      label: 'Audit log',
      show: can('admin.view_audit_log'),
      render: () => <AuditLogTab />,
    },
  ].filter((entry) => entry.show);

  if (tabs.length === 0) {
    return (
      <>
        <PageHeader title="Administration" />
        <EmptyState title="You do not have administration access" />
      </>
    );
  }

  const active = tabs[Math.min(tab, tabs.length - 1)];

  return (
    <>
      <PageHeader title="Administration" subtitle="User accounts, closures and the audit log" />
      <Card>
        <Tabs
          value={Math.min(tab, tabs.length - 1)}
          onChange={(_, next) => setTab(next)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ px: 2 }}
        >
          {tabs.map((entry) => (
            <Tab key={entry.label} label={entry.label} />
          ))}
        </Tabs>
        {active.render()}
      </Card>
    </>
  );
}

const USER_STATUSES = [
  { value: '', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'on_notice', label: 'On notice' },
  { value: 'inactive', label: 'Inactive' },
];

function UsersTab() {
  const dispatch = useAppDispatch();
  const me = useAppSelector(selectCurrentUser);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [department, setDepartment] = useState('');
  const [skills, setSkills] = useState<number[]>([]);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [confirming, setConfirming] = useState(false);

  const { data, loading, error, reload } = useApiResource(
    useCallback(
      () =>
        adminApi.users({
          page: page + 1,
          page_size: 20,
          search: search || undefined,
          employment_status: status || undefined,
          department: department || undefined,
          skills: skills.length ? skills.join(',') : undefined,
        }),
      [page, search, status, department, skills],
    ),
    [page, search, status, department, skills],
  );
  const departments = useApiResource(
    useCallback(() => employeesApi.departments({ page_size: 100 }), []),
    [],
  );
  const deleteUsers = useApiAction(adminApi.deleteUsers);

  // The caller's own row can be listed but never deleted - the server skips
  // it too; keeping it unselectable here just makes the rule visible.
  const deletable = (data?.results ?? []).filter((row) => row.id !== me?.id);
  const allOnPageSelected =
    deletable.length > 0 && deletable.every((row) => selected.includes(row.id));

  const toggleAllOnPage = () => {
    setSelected(allOnPageSelected ? [] : deletable.map((row) => row.id));
  };

  const toggleOne = (id: number) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((entry) => entry !== id) : [...prev, id],
    );
  };

  const runDelete = async () => {
    const result = await deleteUsers.run({ ids: selected });
    if (!result) return;
    const skipped = result.skipped.length ? ` (${result.skipped.length} skipped)` : '';
    dispatch(
      showToast(
        `Deleted ${result.deleted} account${result.deleted === 1 ? '' : 's'}${skipped}.`,
        'info',
      ),
    );
    setConfirming(false);
    setSelected([]);
    setPage(0);
    void reload();
  };

  return (
    <>
      {/* The same filter row as the Employees page, filtering accounts by
          what their employment record says. The actions sit on this row too:
          on their own they left an empty band the width of the card, and
          "Delete selected" belongs beside the filters that produced the
          selection. `alignItems: flex-start` keeps the buttons aligned with
          the inputs rather than stretching to their height. */}
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        sx={{ p: 2 }}
        alignItems={{ xs: 'stretch', md: 'flex-start' }}
      >
        <TextField
          label="Search"
          placeholder="Name, code or email"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
          }}
          size="small"
          sx={{ flex: 1, minWidth: 220 }}
        />
        <TextField
          select
          label="Status"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(0);
          }}
          size="small"
          sx={{ minWidth: 160 }}
        >
          {USER_STATUSES.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Department"
          value={department}
          onChange={(event) => {
            setDepartment(event.target.value);
            setPage(0);
          }}
          size="small"
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">All departments</MenuItem>
          {(departments.data?.results ?? []).map((row) => (
            <MenuItem key={row.id} value={String(row.id)}>
              {row.name}
            </MenuItem>
          ))}
        </TextField>
        <SkillPicker
          value={skills}
          onChange={(ids) => {
            setSkills(ids);
            setPage(0);
          }}
          placeholder="Any skill"
          dense
        />
        <Stack direction="row" spacing={1} sx={{ ml: { md: 'auto' }, flexShrink: 0 }}>
          {selected.length > 0 && (
            <Button
              color="error"
              variant="outlined"
              startIcon={<DeleteOutlineIcon />}
              onClick={() => setConfirming(true)}
            >
              Delete selected ({selected.length})
            </Button>
          )}
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAdding(true)}>
            Add user
          </Button>
        </Stack>
      </Stack>

      {error && <ErrorAlert error={error} onRetry={reload} />}
      {deleteUsers.error && <ErrorAlert error={deleteUsers.error} />}
      {loading ? (
        <LinearProgress />
      ) : !data?.results.length ? (
        <EmptyState title="No accounts match" />
      ) : (
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox
                    size="small"
                    checked={allOnPageSelected}
                    indeterminate={selected.length > 0 && !allOnPageSelected}
                    onChange={toggleAllOnPage}
                    inputProps={{ 'aria-label': 'Select every account on this page' }}
                  />
                </TableCell>
                <TableCell>User</TableCell>
                <TableCell>Employee ID</TableCell>
                <TableCell>Roles</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Last sign-in</TableCell>
                <TableCell align="right">Delete User</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.results.map((row) => (
                <TableRow key={row.id} hover selected={selected.includes(row.id)}>
                  <TableCell padding="checkbox">
                    <Checkbox
                      size="small"
                      checked={selected.includes(row.id)}
                      onChange={() => toggleOne(row.id)}
                      disabled={row.id === me?.id}
                      inputProps={{ 'aria-label': `Select ${row.full_name}` }}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>
                      {row.full_name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {row.email}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {row.employee_code ?? '-'}
                    {row.department ? (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {row.department}
                      </Typography>
                    ) : null}
                  </TableCell>
                  {/* Both facts were already on the payload and simply never
                      rendered: an administrator had to open the Employees page
                      to find out who was HR, and the Status filter above
                      filtered on a column that was not shown. */}
                  <TableCell>
                    {row.roles.length ? (
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        {row.roles.map((slug) => (
                          <Chip key={slug} label={ROLE_LABELS[slug] ?? slug} size="small" />
                        ))}
                      </Stack>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        No role
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={row.is_active ? 'Active' : 'Inactive'}
                      size="small"
                      color={row.is_active ? 'success' : 'default'}
                      variant={row.is_active ? 'filled' : 'outlined'}
                    />
                  </TableCell>
                  <TableCell>
                    {row.last_login_at ? formatDateTime(row.last_login_at) : 'Never'}
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip
                      title={row.id === me?.id ? 'You cannot delete your own account' : ''}
                    >
                      <span>
                        <IconButton
                          size="small"
                          color="error"
                          aria-label={`Delete ${row.full_name}`}
                          disabled={row.id === me?.id || deleteUsers.busy}
                          onClick={() => {
                            setSelected([row.id]);
                            setConfirming(true);
                          }}
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {data && (
        <TablePagination
          component="div"
          count={data.count}
          page={page}
          onPageChange={(_, next) => setPage(next)}
          rowsPerPage={20}
          rowsPerPageOptions={[20]}
        />
      )}

      <Dialog open={confirming} onClose={() => setConfirming(false)} fullWidth maxWidth="xs">
        <ClosableDialogTitle onClose={() => setConfirming(false)}>
          Delete accounts
        </ClosableDialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="error">
              {`${selected.length} account${selected.length === 1 ? '' : 's'} will be permanently deleted, along with each person's employment record, leave, timesheets and documents.`}{' '}
              This cannot be undone. To deactivate instead, use account settings rather than
              deleting.
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={runDelete}
            disabled={deleteUsers.busy}
          >
            {deleteUsers.busy ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {adding && (
        <AddUserDialog
          onClose={() => setAdding(false)}
          onCreated={(user) => {
            setAdding(false);
            dispatch(showToast(`${user.email} can now sign in.`, 'success'));
            void reload();
          }}
        />
      )}
    </>
  );
}
