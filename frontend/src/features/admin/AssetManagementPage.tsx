/**
 * Asset management: issuing company kit and seeing who holds what.
 *
 * The admin's view over everyone. Each person's own assets card - the same one
 * on their record - opens under their row, so issuing, amending and taking back
 * work exactly as they do there, through the same dialog and endpoints.
 * `asset.manage` is checked by the server on every one of those calls.
 */

import AddIcon from '@mui/icons-material/Add';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import SearchIcon from '@mui/icons-material/Search';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
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

import ClosableDialogTitle from '@/components/common/ClosableDialogTitle';
import EmployeePicker from '@/components/common/EmployeePicker';
import { EmptyState, ErrorAlert, TableSkeleton } from '@/components/common/Feedback';
import PageHeader from '@/components/common/PageHeader';
import AssetDialog from '@/features/employees/AssetDialog';
import AssetsCard from '@/features/employees/AssetsCard';
import { useApiResource } from '@/hooks/useApiResource';
import { employeesApi } from '@/services/api/services';
import type { EmployeeListItem } from '@/types/domain';

const PAGE_SIZE = 25;
const DEBOUNCE_MS = 300;

/** Column widths, so the rows line up whatever the names in them. */
const COL = {
  expander: 56,
  department: 190,
  designation: 220,
  assets: 120,
  issue: 120,
} as const;

export default function AssetManagementPage() {
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<number | null>(null);
  // Issuing from the header asks who first; from a row, it already knows.
  const [choosing, setChoosing] = useState(false);
  const [chosen, setChosen] = useState<number | null>(null);
  const [issuingTo, setIssuingTo] = useState<number | null>(null);

  // Debounced so typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(term.trim());
      setPage(0);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);

  const { data, loading, error, reload } = useApiResource(
    useCallback(
      () =>
        employeesApi.list({
          page: page + 1,
          page_size: PAGE_SIZE,
          search: search || undefined,
          employment_status: 'active',
        }),
      [page, search],
    ),
    [page, search],
  );

  const rows: EmployeeListItem[] = data?.results ?? [];
  const toggle = (id: number) => setExpanded((open) => (open === id ? null : id));

  return (
    <>
      <PageHeader
        title="Asset management"
        subtitle="Issue company assets and see who holds what"
        actions={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => {
              setChosen(null);
              setChoosing(true);
            }}
          >
            Issue asset
          </Button>
        }
      />

      <Card>
        <Box sx={{ p: 2 }}>
          <TextField
            fullWidth
            size="small"
            placeholder="Search by name, employee ID, email or department"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
          />
        </Box>

        {error && <ErrorAlert error={error} onRetry={reload} />}
        {loading && !data ? (
          <TableSkeleton rows={6} columns={5} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={search ? 'Nobody matches that search' : 'No employees yet'}
            detail={search ? 'Try a name, an employee ID or a department.' : undefined}
          />
        ) : (
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={{ tableLayout: 'fixed', minWidth: 900 }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: COL.expander }} />
                  <TableCell>Employee</TableCell>
                  <TableCell sx={{ width: COL.department }}>Department</TableCell>
                  <TableCell sx={{ width: COL.designation }}>Designation</TableCell>
                  <TableCell sx={{ width: COL.assets }}>Assets</TableCell>
                  <TableCell sx={{ width: COL.issue }} />
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <Fragment key={row.id}>
                    <TableRow
                      hover
                      selected={expanded === row.id}
                      onClick={() => toggle(row.id)}
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell>
                        <IconButton
                          size="small"
                          aria-label={`Show ${row.full_name}'s assets`}
                          aria-expanded={expanded === row.id}
                          onClick={(event) => {
                            // The row toggles too; once is enough.
                            event.stopPropagation();
                            toggle(row.id);
                          }}
                        >
                          {expanded === row.id ? (
                            <KeyboardArrowUpIcon />
                          ) : (
                            <KeyboardArrowDownIcon />
                          )}
                        </IconButton>
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={1.5} alignItems="center">
                          <Avatar
                            src={row.photo_url ?? undefined}
                            alt=""
                            sx={{ width: 32, height: 32, fontSize: 14 }}
                          >
                            {row.full_name[0]?.toUpperCase()}
                          </Avatar>
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="body2" fontWeight={600} noWrap>
                              {row.full_name}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" noWrap>
                              {row.employee_code}
                            </Typography>
                          </Box>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" noWrap>
                          {row.department_name ?? '-'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" noWrap>
                          {row.designation_name ?? '-'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          variant={row.asset_count ? 'filled' : 'outlined'}
                          color={row.asset_count ? 'primary' : 'default'}
                          label={row.asset_count ?? 0}
                        />
                      </TableCell>
                      {/* Issuing is not a request to open the row. */}
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<AddIcon />}
                          onClick={() => setIssuingTo(row.id)}
                          aria-label={`Issue an asset to ${row.full_name}`}
                        >
                          Issue
                        </Button>
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={6} sx={{ p: 0, borderBottom: 0 }}>
                        <Collapse in={expanded === row.id} unmountOnExit>
                          <Box sx={{ px: 2, py: 2, pl: `${COL.expander + 8}px` }}>
                            <AssetsCard employeeId={row.id} canManage onChanged={reload} />
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
      </Card>

      {/* Issue from the header: who to first, then the usual asset form. */}
      <Dialog open={choosing} onClose={() => setChoosing(false)} fullWidth maxWidth="sm">
        <ClosableDialogTitle onClose={() => setChoosing(false)}>
          Issue an asset
        </ClosableDialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1 }}>
            <EmployeePicker
              value={chosen}
              onChange={setChosen}
              label="Issue to"
              helperText="Start typing a name or an employee ID."
              required
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setChoosing(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={chosen === null}
            onClick={() => {
              setChoosing(false);
              setIssuingTo(chosen);
            }}
          >
            Continue
          </Button>
        </DialogActions>
      </Dialog>

      {issuingTo !== null && (
        <AssetDialog
          employeeId={issuingTo}
          asset={null}
          onClose={() => setIssuingTo(null)}
          onSaved={() => {
            setIssuingTo(null);
            reload();
          }}
        />
      )}
    </>
  );
}
