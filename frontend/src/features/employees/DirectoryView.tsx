/**
 * The searchable company directory.
 *
 * Backed by /employees/directory/, which every signed-in user may read and
 * which carries work contact details only. Every card opens the details
 * dialog; the full HR record stays behind a permission-gated button inside it.
 */

import ClearIcon from '@mui/icons-material/Clear';
import EmailIcon from '@mui/icons-material/Email';
import GridViewIcon from '@mui/icons-material/GridView';
import PlaceIcon from '@mui/icons-material/Place';
import SearchIcon from '@mui/icons-material/Search';
import TableRowsIcon from '@mui/icons-material/TableRows';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import LinearProgress from '@mui/material/LinearProgress';
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
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useState } from 'react';

import { EmptyState, ErrorAlert } from '@/components/common/Feedback';
import SkillPicker from '@/components/common/SkillPicker';
import EmployeeDetailsDialog from '@/features/employees/EmployeeDetailsDialog';
import { useApiResource } from '@/hooks/useApiResource';
import { employeesApi } from '@/services/api/services';
import { identityChipSx } from '@/styles/identity';
import type { DirectoryEntry } from '@/types/domain';

const PAGE_SIZE = 12;
const DEBOUNCE_MS = 300;

function EmployeeCard({ entry, onOpen }: { entry: DirectoryEntry; onOpen?: () => void }) {
  const body = (
    <CardContent sx={{ height: '100%' }}>
      <Stack direction="row" spacing={2} alignItems="flex-start">
        <Avatar
          src={entry.photo_url ?? undefined}
          alt={entry.full_name}
          sx={{ width: 48, height: 48, bgcolor: 'primary.light', fontWeight: 700 }}
        >
          {entry.full_name[0]?.toUpperCase()}
        </Avatar>

        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <Typography variant="body1" fontWeight={700} noWrap title={entry.full_name}>
            {entry.full_name}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            {entry.employee_code}
            {entry.designation_name ? ` · ${entry.designation_name}` : ''}
          </Typography>

          <Stack direction="row" spacing={0.5} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
            {entry.department_name && (
              <Chip
                size="small"
                label={entry.department_name}
                sx={identityChipSx(entry.department_name)}
              />
            )}
            {entry.work_location && (
              <Chip
                size="small"
                variant="outlined"
                icon={<PlaceIcon fontSize="small" />}
                label={entry.work_location}
              />
            )}
          </Stack>

          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 1 }}>
            <EmailIcon fontSize="inherit" color="disabled" />
            <Typography variant="caption" color="text.secondary" noWrap title={entry.email}>
              {entry.email}
            </Typography>
          </Stack>

          {entry.reporting_manager_name && (
            <Typography
              variant="caption"
              color="text.disabled"
              display="block"
              sx={{ mt: 0.5 }}
            >
              Reports to {entry.reporting_manager_name}
            </Typography>
          )}
        </Box>
      </Stack>
    </CardContent>
  );

  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      {onOpen ? (
        <CardActionArea onClick={onOpen} sx={{ height: '100%' }}>
          {body}
        </CardActionArea>
      ) : (
        body
      )}
    </Card>
  );
}

export default function DirectoryView() {
  const [selected, setSelected] = useState<number | null>(null);
  // The same two ways of looking as the My-scope tab, with the same control.
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [skills, setSkills] = useState<number[]>([]);
  const [page, setPage] = useState(0);

  // Debounced so typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(term.trim());
      setPage(0);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [term]);

  const { data, loading, error, reload } = useApiResource(
    useCallback(
      () =>
        employeesApi.directory({
          page: page + 1,
          page_size: PAGE_SIZE,
          search: search || undefined,
          department: department || undefined,
          skills: skills.length ? skills.join(',') : undefined,
        }),
      [page, search, department, skills],
    ),
    [page, search, department, skills],
  );

  const departments = useApiResource(
    useCallback(() => employeesApi.departments({ page_size: 100 }), []),
    [],
  );

  return (
    <Box>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ mb: 2 }}
        alignItems={{ sm: 'center' }}
      >
        <TextField
          label="Search employees"
          placeholder="Name, employee ID, email, designation or department"
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
          helperText={skills.length > 1 ? 'Shows people who have all of them.' : undefined}
          dense
        />
        <ToggleButtonGroup
          exclusive
          size="small"
          value={view}
          onChange={(_, next) => next && setView(next)}
          aria-label="Directory layout"
          sx={{ flexShrink: 0 }}
        >
          <ToggleButton value="cards" aria-label="Card view">
            <GridViewIcon fontSize="small" sx={{ mr: 0.5 }} /> Cards
          </ToggleButton>
          <ToggleButton value="table" aria-label="Table view">
            <TableRowsIcon fontSize="small" sx={{ mr: 0.5 }} /> Table
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {error && <ErrorAlert error={error} onRetry={reload} />}
      {loading && <LinearProgress sx={{ mb: 2 }} />}

      {!loading && data?.results.length === 0 ? (
        <EmptyState
          title={search ? `Nobody matches "${search}"` : 'No employees to show'}
          detail={search ? 'Try a different name, employee ID or department.' : undefined}
        />
      ) : view === 'cards' ? (
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: {
              xs: '1fr',
              sm: 'repeat(2, 1fr)',
              lg: 'repeat(3, 1fr)',
            },
          }}
        >
          {(data?.results ?? []).map((entry) => (
            <EmployeeCard key={entry.id} entry={entry} onOpen={() => setSelected(entry.id)} />
          ))}
        </Box>
      ) : (
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Employee</TableCell>
                <TableCell>Department</TableCell>
                <TableCell>Location</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Reports to</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(data?.results ?? []).map((entry) => (
                <TableRow
                  key={entry.id}
                  hover
                  sx={{ cursor: 'pointer' }}
                  onClick={() => setSelected(entry.id)}
                >
                  <TableCell>
                    <Stack direction="row" spacing={1.5} alignItems="center">
                      <Avatar
                        src={entry.photo_url ?? undefined}
                        alt={entry.full_name}
                        sx={{ width: 32, height: 32, fontSize: 13 }}
                      >
                        {entry.full_name[0]?.toUpperCase()}
                      </Avatar>
                      <Box>
                        <Typography variant="body2" fontWeight={600}>
                          {entry.full_name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {entry.employee_code}
                          {entry.designation_name ? ` · ${entry.designation_name}` : ''}
                        </Typography>
                      </Box>
                    </Stack>
                  </TableCell>
                  <TableCell>{entry.department_name ?? '—'}</TableCell>
                  <TableCell>{entry.work_location || '—'}</TableCell>
                  <TableCell>
                    <Typography variant="body2" noWrap title={entry.email}>
                      {entry.email}
                    </Typography>
                  </TableCell>
                  <TableCell>{entry.reporting_manager_name ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {data && data.count > PAGE_SIZE && (
        <TablePagination
          component="div"
          count={data.count}
          page={page}
          onPageChange={(_, next) => setPage(next)}
          rowsPerPage={PAGE_SIZE}
          rowsPerPageOptions={[PAGE_SIZE]}
        />
      )}

      <EmployeeDetailsDialog
        employeeId={selected}
        onClose={() => setSelected(null)}
        onNavigate={setSelected}
      />

      {data && (
        <Typography variant="caption" color="text.disabled" sx={{ mt: 1, display: 'block' }}>
          {data.count} active employee{data.count === 1 ? '' : 's'} · select someone to see
          their details
        </Typography>
      )}
    </Box>
  );
}
