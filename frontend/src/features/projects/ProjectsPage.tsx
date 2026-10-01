/** Project portfolio: list, filter, create. */

import AddIcon from '@mui/icons-material/Add';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useAppDispatch } from '@/app/hooks';
import { EmptyState, ErrorAlert, TableSkeleton } from '@/components/common/Feedback';
import PageHeader from '@/components/common/PageHeader';
import StatusChip from '@/components/common/StatusChip';
import ProjectTeamRow from '@/features/projects/ProjectTeamRow';
import { showToast } from '@/features/ui/uiSlice';
import { usePermissions } from '@/hooks/usePermissions';
import { useApiAction, useApiResource } from '@/hooks/useApiResource';
import { employeesApi, projectsApi } from '@/services/api/services';
import { formatDate, todayIso } from '@/utils/date';
import ClosableDialogTitle from '@/components/common/ClosableDialogTitle';

const STATUSES = [
  { value: '', label: 'All statuses' },
  { value: 'planned', label: 'Planned' },
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default function ProjectsPage() {
  const { can } = usePermissions();

  /**
   * The dashboard's "Active projects" card links here as `?status=active`, so
   * the page opens showing the three it just counted rather than the whole
   * portfolio. Read on every change, not once on mount, so following a second
   * link while already on the page moves the filter too. An unknown value is
   * ignored, which leaves the filter on All statuses.
   */
  const [params] = useSearchParams();
  const wantedStatus = params.get('status') ?? '';
  const statusFromUrl = STATUSES.some((option) => option.value === wantedStatus)
    ? wantedStatus
    : '';

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(statusFromUrl);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    setStatus(statusFromUrl);
    setPage(0);
  }, [statusFromUrl]);

  const fetcher = useCallback(
    () =>
      projectsApi.list({
        page: page + 1,
        page_size: pageSize,
        search: search || undefined,
        status: status || undefined,
      }),
    [page, pageSize, search, status],
  );
  const { data, loading, error, reload } = useApiResource(fetcher, [
    page,
    pageSize,
    search,
    status,
  ]);

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle={data ? `${data.count} project${data.count === 1 ? '' : 's'}` : 'Portfolio'}
        actions={
          can('project.manage') ? (
            <Button
              startIcon={<AddIcon />}
              variant="contained"
              onClick={() => setCreating(true)}
            >
              New project
            </Button>
          ) : undefined
        }
      />

      {error && <ErrorAlert error={error} onRetry={reload} />}

      <Card>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ p: 2 }}>
          <TextField
            label="Search"
            placeholder="Code, name or client"
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
            sx={{ minWidth: 180 }}
          >
            {STATUSES.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
        </Stack>

        {loading ? (
          <TableSkeleton columns={6} />
        ) : !data?.results.length ? (
          <EmptyState
            title="No projects to show"
            detail="You see the projects you are a member of; ask a manager to add you to a team."
          />
        ) : (
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell width={48} />
                  <TableCell>Code</TableCell>
                  <TableCell>Project</TableCell>
                  <TableCell>Client</TableCell>
                  <TableCell>Manager</TableCell>
                  <TableCell align="right">Team</TableCell>
                  <TableCell align="right">Total allocation</TableCell>
                  <TableCell>Start</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.results.map((row) => (
                  <Fragment key={row.id}>
                    <TableRow
                      hover
                      sx={{ cursor: 'pointer' }}
                      onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                    >
                      <TableCell sx={{ pr: 0 }}>
                        <IconButton
                          size="small"
                          aria-label={
                            expanded === row.id
                              ? `Hide the team on ${row.code}`
                              : `Show the team on ${row.code}`
                          }
                          onClick={(event) => {
                            // The row toggles too; without this the click would
                            // be counted twice and the panel would stay shut.
                            event.stopPropagation();
                            setExpanded(expanded === row.id ? null : row.id);
                          }}
                        >
                          {expanded === row.id ? (
                            <KeyboardArrowUpIcon />
                          ) : (
                            <KeyboardArrowDownIcon />
                          )}
                        </IconButton>
                      </TableCell>
                      <TableCell>{row.code}</TableCell>
                      <TableCell>
                        <Typography variant="body2" fontWeight={600}>
                          {row.name}
                        </Typography>
                        {!row.is_billable && (
                          <Typography variant="caption" color="text.secondary">
                            Internal
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>{row.client_name || '-'}</TableCell>
                      <TableCell>{row.project_manager_name ?? '-'}</TableCell>
                      <TableCell align="right">{row.member_count}</TableCell>
                      <TableCell align="right">{row.total_allocation}%</TableCell>
                      <TableCell>{formatDate(row.start_date)}</TableCell>
                      <TableCell>
                        <StatusChip status={row.status} />
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={9} sx={{ py: 0, borderBottom: 0 }}>
                        <Collapse in={expanded === row.id} unmountOnExit>
                          <Box sx={{ pl: 5, pr: 2 }}>
                            <ProjectTeamRow projectId={row.id} />
                          </Box>
                        </Collapse>
                      </TableCell>
                    </TableRow>
                  </Fragment>
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
            rowsPerPage={pageSize}
            onRowsPerPageChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(0);
            }}
            rowsPerPageOptions={[10, 25, 50]}
          />
        )}
      </Card>

      <ProjectFormDialog
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={() => {
          setCreating(false);
          void reload();
        }}
      />
    </>
  );
}

function ProjectFormDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dispatch = useAppDispatch();
  const [form, setForm] = useState({
    code: '',
    name: '',
    client_name: '',
    description: '',
    department: '',
    project_manager: '',
    status: 'planned',
    start_date: todayIso(),
    end_date: '',
    is_billable: 'true',
  });

  const departments = useApiResource(
    useCallback(() => employeesApi.departments({ page_size: 100 }), []),
    [],
  );
  const managers = useApiResource(
    useCallback(() => employeesApi.list({ page_size: 100, employment_status: 'active' }), []),
    [],
  );
  const create = useApiAction(projectsApi.create);

  const set = (field: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [field]: event.target.value }));

  const handleSubmit = async () => {
    const payload: Record<string, unknown> = {
      ...form,
      code: form.code.trim().toUpperCase(),
      is_billable: form.is_billable === 'true',
    };
    for (const key of ['department', 'project_manager', 'end_date'] as const) {
      if (!form[key]) delete payload[key];
    }

    const saved = await create.run(payload);
    if (saved) {
      dispatch(showToast(`Project ${saved.code} created.`, 'success'));
      onSaved();
    }
  };

  const fieldProps = (field: string) => ({
    error: Boolean(create.fieldErrors[field]),
    helperText: create.fieldErrors[field] ?? ' ',
  });

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <ClosableDialogTitle onClose={onClose}>New project</ClosableDialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {create.error && !Object.keys(create.fieldErrors).length && (
            <Alert severity="error" onClose={create.clearError}>
              {create.error.message}
            </Alert>
          )}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Code"
              value={form.code}
              onChange={set('code')}
              placeholder="PRJ-010"
              required
              fullWidth
              {...fieldProps('code')}
            />
            <TextField
              label="Name"
              value={form.name}
              onChange={set('name')}
              required
              fullWidth
              {...fieldProps('name')}
            />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Client"
              value={form.client_name}
              onChange={set('client_name')}
              fullWidth
              helperText="Leave blank for internal projects."
            />
            <TextField
              select
              label="Billable"
              value={form.is_billable}
              onChange={set('is_billable')}
              fullWidth
              helperText=" "
            >
              <MenuItem value="true">Billable</MenuItem>
              <MenuItem value="false">Internal</MenuItem>
            </TextField>
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              select
              label="Department"
              value={form.department}
              onChange={set('department')}
              fullWidth
              helperText=" "
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
              label="Project manager"
              value={form.project_manager}
              onChange={set('project_manager')}
              fullWidth
              helperText=" "
            >
              <MenuItem value="">Not assigned</MenuItem>
              {(managers.data?.results ?? []).map((row) => (
                <MenuItem key={row.id} value={String(row.id)}>
                  {row.full_name}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              select
              label="Status"
              value={form.status}
              onChange={set('status')}
              fullWidth
              helperText=" "
            >
              {STATUSES.filter((option) => option.value).map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Start date"
              type="date"
              value={form.start_date}
              onChange={set('start_date')}
              required
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
              {...fieldProps('start_date')}
            />
            <TextField
              label="End date"
              type="date"
              value={form.end_date}
              onChange={set('end_date')}
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
              {...fieldProps('end_date')}
            />
          </Stack>
          <TextField
            label="Description"
            value={form.description}
            onChange={set('description')}
            multiline
            minRows={2}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={create.busy}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={create.busy}>
          {create.busy ? 'Saving...' : 'Create project'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
