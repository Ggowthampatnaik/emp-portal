/**
 * The audit trail, read-only.
 *
 * Every state change in the portal already calls `record_audit(...)` and the
 * endpoint has always existed — there was simply nothing on screen that read
 * it, so the trail was being written and never looked at. This is the page you
 * open to answer "who changed this, and when".
 *
 * Rows are never editable: an audit log you can edit is not an audit log. The
 * `changes` payload varies per action, so it is rendered as whatever it is
 * rather than being forced into columns that only suit one entity type.
 */

import SearchIcon from '@mui/icons-material/Search';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
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
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useState } from 'react';

import { EmptyState, ErrorAlert } from '@/components/common/Feedback';
import AuditLogEntryDialog from '@/features/admin/AuditLogEntryDialog';
import { useApiResource } from '@/hooks/useApiResource';
import type { AuditLogEntry } from '@/types/domain';
import { adminApi } from '@/services/api/services';
import { formatDateTime } from '@/utils/date';

const PAGE_SIZE = 20;

/** Mirrors `common.enums.AuditAction`. */
const ACTIONS = [
  { value: '', label: 'All actions' },
  { value: 'create', label: 'Create' },
  { value: 'update', label: 'Update' },
  { value: 'delete', label: 'Delete' },
  { value: 'approve', label: 'Approve' },
  { value: 'reject', label: 'Reject' },
  { value: 'submit', label: 'Submit' },
  { value: 'export', label: 'Export' },
  { value: 'login', label: 'Login' },
  { value: 'logout', label: 'Logout' },
];

/**
 * Colour carries the weight of the action, not its category — a deletion and
 * a rejection are the two you scan a log for.
 */
function actionColor(action: string): 'default' | 'success' | 'warning' | 'error' | 'info' {
  if (action === 'delete' || action === 'reject') return 'error';
  if (action === 'approve') return 'success';
  if (action === 'create' || action === 'submit') return 'info';
  if (action === 'export') return 'warning';
  return 'default';
}

export default function AuditLogTab() {
  /** The entry whose full record is open. */
  const [selected, setSelected] = useState<AuditLogEntry | null>(null);
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(0);

  const fetcher = useCallback(
    () =>
      adminApi.auditLogs({
        search: search || undefined,
        action: action || undefined,
        page: page + 1,
        page_size: PAGE_SIZE,
      }),
    [search, action, page],
  );
  // With no deps the resource fetched once and never again: typing in Search,
  // choosing an Action or paging updated state while the rows stayed put.
  const { data, loading, error, reload } = useApiResource(fetcher, [search, action, page]);

  // A filter change with the reader still on page 5 would ask the server for a
  // page the new result set may not have.
  useEffect(() => {
    setPage(0);
  }, [search, action]);

  const rows = data?.results ?? [];

  return (
    <Box>
      {/* Matches the padding the other tabs use. Without it the filter row
          butts against the tab bar and the floating label clips the border. */}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ p: 2 }}>
        <TextField
          label="Search"
          placeholder="Actor, record or request ID"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          size="small"
          sx={{ flexGrow: 1 }}
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
        <TextField
          select
          label="Action"
          value={action}
          onChange={(event) => setAction(event.target.value)}
          size="small"
          sx={{ minWidth: 180 }}
        >
          {ACTIONS.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      {error && <ErrorAlert error={error} onRetry={reload} />}
      {loading && <LinearProgress sx={{ mb: 2 }} />}

      {!loading && rows.length === 0 ? (
        <EmptyState
          title="Nothing recorded yet"
          detail="Changes made in the portal will appear here."
        />
      ) : (
        <>
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>When</TableCell>
                  <TableCell>Who</TableCell>
                  <TableCell>Action</TableCell>
                  <TableCell>Record</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={row.id}
                    hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() => setSelected(row)}
                  >
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {formatDateTime(row.created_at)}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{row.actor_name ?? 'System'}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {row.actor_email}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={row.action}
                        size="small"
                        color={actionColor(row.action)}
                        variant={actionColor(row.action) === 'default' ? 'outlined' : 'filled'}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {row.entity_label || row.entity_type}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {row.entity_type}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          <AuditLogEntryDialog entry={selected} onClose={() => setSelected(null)} />

          <TablePagination
            component="div"
            count={data?.count ?? 0}
            page={page}
            onPageChange={(_, next) => setPage(next)}
            rowsPerPage={PAGE_SIZE}
            rowsPerPageOptions={[PAGE_SIZE]}
          />
        </>
      )}
    </Box>
  );
}
