/**
 * Who is out today.
 *
 * HR's answer to "can I ask them this afternoon?". The dashboard's "On leave
 * today" card counts approved leave covering today and links here, and this
 * page asks the API the same question, so the number and the names can never
 * disagree. Overlapping today rather than starting today: somebody in the
 * middle of a week off is still out.
 *
 * The server scopes the rows, and the route is behind `leave.view_all`, so
 * this is the company-wide picture for the roles that hold it.
 */

import EventBusyIcon from '@mui/icons-material/EventBusy';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useCallback } from 'react';

import { EmptyState, ErrorAlert, TableSkeleton } from '@/components/common/Feedback';
import PageHeader from '@/components/common/PageHeader';
import { useApiResource } from '@/hooks/useApiResource';
import { leaveApi } from '@/services/api/services';
import type { LeaveRequest } from '@/types/domain';
import { formatDate, todayIso } from '@/utils/date';

/** Initials for someone with no photo on a leave row. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')
  ).toUpperCase();
}

/**
 * How long they are away for, in the terms somebody asking would use: a half
 * day says which half, a single day needs no dates, and a longer absence is
 * worth knowing the return date for.
 */
function spell(row: LeaveRequest, today: string): string {
  if (row.day_part && row.day_part !== 'full') {
    return row.day_part === 'first_half' ? 'Half day, morning' : 'Half day, afternoon';
  }
  if (row.start_date === row.end_date) return 'Today only';
  if (row.end_date === today) return `Back tomorrow · since ${formatDate(row.start_date)}`;
  return `Until ${formatDate(row.end_date)} · since ${formatDate(row.start_date)}`;
}

export default function OnLeaveTodayPage() {
  const today = todayIso();
  const fetcher = useCallback(
    () => leaveApi.list({ status: 'approved', from: today, to: today, page_size: 100 }),
    [today],
  );
  const { data, loading, error, reload } = useApiResource(fetcher, [today]);

  // Sorted here rather than by the API: a roster reads by name, and the
  // endpoint only orders by date, applied_at or status.
  const rows = [...(data?.results ?? [])].sort((a, b) =>
    a.employee_name.localeCompare(b.employee_name),
  );

  return (
    <>
      <PageHeader
        title="On leave today"
        subtitle={
          data
            ? `${rows.length} ${rows.length === 1 ? 'person is' : 'people are'} away on ${formatDate(today)}`
            : `Approved leave covering ${formatDate(today)}`
        }
      />

      {error && <ErrorAlert error={error} onRetry={reload} />}
      {loading && data && <LinearProgress sx={{ mb: 2 }} />}

      <Card>
        {loading && !data ? (
          <TableSkeleton columns={5} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="Nobody is on leave today"
            detail="Everyone with an approved request is either back already or not away yet."
          />
        ) : (
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Employee</TableCell>
                  <TableCell>Department</TableCell>
                  <TableCell>Leave type</TableCell>
                  <TableCell>Away</TableCell>
                  <TableCell>Reason</TableCell>
                  <TableCell>Contact</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} hover>
                    <TableCell>
                      <Stack direction="row" spacing={1.5} alignItems="center">
                        <Avatar
                          sx={{
                            width: 32,
                            height: 32,
                            fontSize: 13,
                            fontWeight: 700,
                            bgcolor: 'primary.light',
                          }}
                        >
                          {initials(row.employee_name)}
                        </Avatar>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" fontWeight={600} noWrap>
                            {row.employee_name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {row.employee_code}
                          </Typography>
                        </Box>
                      </Stack>
                    </TableCell>
                    <TableCell>{row.department_name ?? '-'}</TableCell>
                    <TableCell>
                      <Chip size="small" variant="outlined" label={row.leave_type_name} />
                    </TableCell>
                    <TableCell>{spell(row, today)}</TableCell>
                    <TableCell sx={{ maxWidth: 280 }}>
                      <Typography variant="body2" title={row.reason} noWrap>
                        {row.reason || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell>{row.contact_number || '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>

      {rows.length > 0 && (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 2 }}>
          <EventBusyIcon fontSize="small" color="disabled" />
          <Typography variant="caption" color="text.secondary">
            Approved leave only. A request still waiting on a manager or on HR is not counted
            here.
          </Typography>
        </Stack>
      )}
    </>
  );
}
