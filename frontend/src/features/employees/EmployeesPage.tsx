/**
 * The Employees page.
 *
 * Everyone lands on the company directory. Users who may see full records
 * (managers, HR, Admin) get a second tab with the management table - server
 * side search, filters, onboarding - scoped to what they are allowed to see.
 */

import AddIcon from '@mui/icons-material/Add';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import ApartmentIcon from '@mui/icons-material/Apartment';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';

import { EmptyState, ErrorAlert, TableSkeleton } from '@/components/common/Feedback';
import PageHeader from '@/components/common/PageHeader';
import SkillPicker from '@/components/common/SkillPicker';
import ClearIcon from '@mui/icons-material/Clear';
import GridViewIcon from '@mui/icons-material/GridView';
import SearchIcon from '@mui/icons-material/Search';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import TableRowsIcon from '@mui/icons-material/TableRows';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import ChangeRoleDialog from '@/features/employees/ChangeRoleDialog';
import EmployeeCardGrid from '@/features/employees/EmployeeCardGrid';
import RoleSelect from '@/features/employees/RoleSelect';
import Chip from '@mui/material/Chip';
import DirectoryView from '@/features/employees/DirectoryView';
import EmployeeDetailsDialog from '@/features/employees/EmployeeDetailsDialog';
import EmployeeFormDialog from '@/features/employees/EmployeeFormDialog';
import { usePermissions } from '@/hooks/usePermissions';
import { useApiResource } from '@/hooks/useApiResource';
import { employeesApi } from '@/services/api/services';
import { ROLES } from '@/types/auth';
import type { EmployeeListItem } from '@/types/domain';
import { formatDate } from '@/utils/date';

export default function EmployeesPage() {
  const navigate = useNavigate();
  const { can, canAny, roles, isSuperAdmin, user: me } = usePermissions();
  const mayManage = canAny('employee.view_team', 'employee.view_all');
  const [tab, setTab] = useState(0);

  /**
   * Admin's Employees list is an oversight view: who works here, who reports to
   * whom. Two things follow from that, both of them below - a click opens the
   * summary card rather than loading a record page, and the list does not carry
   * the Role column. Super Admin keeps the inline role control, since the
   * Employees list is the whole of their module.
   */
  const adminOversight = roles.includes(ROLES.ADMIN) && !isSuperAdmin;
  const showRoleColumn = !adminOversight;
  /**
   * Both oversight roles answer "who is this" far more often than they edit
   * anyone, so a click gives them the card rather than a page load - and for
   * both of them the card is where it ends. Neither record page holds anything
   * their card does not, so neither card offers a way through to one.
   */
  const opensAsCard = adminOversight || isSuperAdmin;
  const [selected, setSelected] = useState<number | null>(null);
  // Latched on the first open, so the dialog's load cycle never runs on a
  // visit that does not use it, and closing keeps its animation.
  const [dialogUsed, setDialogUsed] = useState(false);

  const openPerson = (id: number) => {
    if (!opensAsCard) {
      navigate(`/employees/${id}`);
      return;
    }
    setDialogUsed(true);
    setSelected(id);
  };

  // Departments links its headcount here as `/employees?department=<id>`, so
  // clicking a number lands on exactly the people it counted.
  const [params] = useSearchParams();

  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState(() => params.get('department') ?? '');
  const [skills, setSkills] = useState<number[]>([]);

  // Debounced so typing does not fire a request per keystroke - the same
  // rhythm as the directory tab beside this one.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(term.trim());
      setPage(0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [term]);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [creating, setCreating] = useState(false);
  const [roleFor, setRoleFor] = useState<EmployeeListItem | null>(null);
  // Cards lead for looking; the table stays one click away for working
  // (roles, columns). Super Admin has the table only: their Employees list is
  // where roles are set, and the role control lives in a table column - a card
  // grid is the layout for browsing people, not for administering them.
  const [view, setView] = useState<'cards' | 'table'>(isSuperAdmin ? 'table' : 'cards');
  const showCards = !isSuperAdmin && view === 'cards';
  const mayChangeRoles = can('admin.manage_roles');

  const fetcher = useCallback(
    () =>
      employeesApi.list({
        page: page + 1,
        page_size: pageSize,
        search: search || undefined,
        department: department || undefined,
        // Your own record is under My profile; finding yourself in the list
        // you are browsing reads as a mistake. Excluded on the server so the
        // count above and the pager below stay honest.
        exclude_self: true,
        // A comma-separated list; the backend keeps only people who have them all.
        skills: skills.length ? skills.join(',') : undefined,
      }),
    [page, pageSize, search, department, skills],
  );
  const { data, loading, error, reload } = useApiResource(fetcher, [
    page,
    pageSize,
    search,
    department,
    skills,
  ]);

  const departments = useApiResource(
    useCallback(() => employeesApi.departments({ page_size: 100 }), []),
    [],
  );

  // A plain employee's "scope" is themselves - a tab showing your own card
  // next to the directory that already contains you is a tab too many. They
  // get the directory alone; the scope tab is for people who manage one.
  if (!mayManage) {
    return (
      <>
        <PageHeader title="Company Directory" subtitle="Everyone at Trigyan, searchable" />
        <DirectoryView />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Employees"
        subtitle={
          data
            ? `${data.count} employee${data.count === 1 ? '' : 's'} in your scope`
            : 'Directory'
        }
        actions={
          <Stack direction="row" spacing={1}>
            {/* Super Admin's module is the people list alone - no chart or
                department admin in their header - and the two pages are
                guarded routes, so the buttons only show to those who can
                follow them. */}
            {!isSuperAdmin && mayManage && (
              <>
                <Button
                  component={RouterLink}
                  to="/employees/org-chart"
                  startIcon={<AccountTreeIcon />}
                  variant="outlined"
                >
                  Org chart
                </Button>
                <Button
                  component={RouterLink}
                  to="/employees/departments"
                  startIcon={<ApartmentIcon />}
                  variant="outlined"
                >
                  Departments
                </Button>
              </>
            )}
            {can('employee.create') && !isSuperAdmin && (
              <Button
                startIcon={<AddIcon />}
                variant="contained"
                onClick={() => setCreating(true)}
              >
                Add employee
              </Button>
            )}
          </Stack>
        }
      />

      {/* Super Admin gets the management table alone - a tab bar with one
          tab is just furniture, so it goes too. */}
      {!isSuperAdmin && (
        <Tabs
          value={tab}
          onChange={(_, next) => setTab(next)}
          sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab label="My scope" />
          <Tab label="Company directory" />
        </Tabs>
      )}

      {tab === 1 && !isSuperAdmin && <DirectoryView />}

      {(tab === 0 || isSuperAdmin) && (
        <>
          {error && <ErrorAlert error={error} onRetry={reload} />}

          <Card>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={2}
              alignItems={{ md: 'center' }}
              sx={{ p: 2 }}
            >
              <TextField
                label="Search employees"
                placeholder="Name, ID, email or designation"
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                size="small"
                fullWidth
                sx={{ flex: 1 }}
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon fontSize="small" />
                      </InputAdornment>
                    ),
                    endAdornment: term ? (
                      <InputAdornment position="end">
                        <IconButton
                          size="small"
                          onClick={() => setTerm('')}
                          aria-label="Clear search"
                        >
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      </InputAdornment>
                    ) : undefined,
                  },
                }}
              />
              <TextField
                select
                label="Department"
                value={department}
                onChange={(event) => {
                  setDepartment(event.target.value);
                  setPage(0);
                }}
                size="small"
                sx={{ minWidth: 200 }}
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
              {/* No layout switch where there is only one layout. */}
              {!isSuperAdmin && (
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={view}
                  onChange={(_, next) => next && setView(next)}
                  aria-label="List layout"
                  sx={{ flexShrink: 0 }}
                >
                  <ToggleButton value="cards" aria-label="Card view">
                    <GridViewIcon fontSize="small" sx={{ mr: 0.5 }} /> Cards
                  </ToggleButton>
                  <ToggleButton value="table" aria-label="Table view">
                    <TableRowsIcon fontSize="small" sx={{ mr: 0.5 }} /> Table
                  </ToggleButton>
                </ToggleButtonGroup>
              )}
            </Stack>

            {loading ? (
              <TableSkeleton columns={showRoleColumn ? 7 : 6} />
            ) : !data || data.results.length === 0 ? (
              <EmptyState
                title="No employees match"
                detail="Try clearing the filters, or widen your search."
              />
            ) : showCards ? (
              <EmployeeCardGrid employees={data.results} onOpenProfile={openPerson} />
            ) : (
              <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Employee ID</TableCell>
                      <TableCell>Name</TableCell>
                      <TableCell>Department</TableCell>
                      <TableCell>Designation</TableCell>
                      <TableCell>Reports to</TableCell>
                      <TableCell>Joined</TableCell>
                      {showRoleColumn && <TableCell>Role</TableCell>}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.results.map((row) => (
                      <TableRow
                        key={row.id}
                        hover
                        sx={{ cursor: 'pointer' }}
                        onClick={() => openPerson(row.id)}
                      >
                        <TableCell>{row.employee_code}</TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={1.5} alignItems="center">
                            <Avatar
                              src={row.photo_url ?? undefined}
                              alt={row.full_name}
                              sx={{
                                width: 32,
                                height: 32,
                                fontSize: 13,
                                bgcolor: 'primary.light',
                              }}
                            >
                              {row.full_name[0]?.toUpperCase()}
                            </Avatar>
                            <Box>
                              <Typography variant="body2" fontWeight={600}>
                                {row.full_name}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {row.email}
                              </Typography>
                            </Box>
                          </Stack>
                        </TableCell>
                        <TableCell>{row.department_name ?? '-'}</TableCell>
                        <TableCell>{row.designation_name ?? '-'}</TableCell>
                        <TableCell>{row.reporting_manager_name ?? '-'}</TableCell>
                        <TableCell>{formatDate(row.date_of_joining)}</TableCell>
                        {showRoleColumn && (
                          <TableCell onClick={(event) => event.stopPropagation()}>
                            {isSuperAdmin && row.user_id !== me?.id ? (
                              // Super Admin changes roles straight in the row.
                              <RoleSelect
                                key={row.roles.join(',')}
                                employee={row}
                                onSaved={() => void reload()}
                              />
                            ) : (
                              <Stack
                                direction="row"
                                spacing={0.5}
                                alignItems="center"
                                useFlexGap
                              >
                                {row.roles.map((role) => (
                                  <Chip
                                    key={role}
                                    size="small"
                                    variant="outlined"
                                    label={role}
                                  />
                                ))}
                                {mayChangeRoles && row.user_id !== me?.id && (
                                  <Button size="small" onClick={() => setRoleFor(row)}>
                                    Change role
                                  </Button>
                                )}
                              </Stack>
                            )}
                          </TableCell>
                        )}
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
                rowsPerPage={pageSize}
                onRowsPerPageChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(0);
                }}
                rowsPerPageOptions={[10, 25, 50, 100]}
              />
            )}
          </Card>
        </>
      )}

      {roleFor && (
        <ChangeRoleDialog
          employee={roleFor}
          onClose={() => setRoleFor(null)}
          onSaved={() => {
            setRoleFor(null);
            void reload();
          }}
        />
      )}

      <EmployeeFormDialog
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={() => {
          setCreating(false);
          void reload();
        }}
      />

      {/* The summary card Admin gets instead of a page load. `onNavigate` lets
          the reporting-manager line inside it walk to the next person without
          closing, exactly as it does on the directory tab. */}
      {dialogUsed && (
        <EmployeeDetailsDialog
          employeeId={selected}
          onClose={() => setSelected(null)}
          onNavigate={setSelected}
        />
      )}
    </>
  );
}
