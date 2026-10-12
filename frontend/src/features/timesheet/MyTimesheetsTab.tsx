/** My timesheet history. */

import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useCallback, useState } from 'react';

import { EmptyState, ErrorAlert, TableSkeleton } from '@/components/common/Feedback';
import StatusChip from '@/components/common/StatusChip';
import { useApiResource } from '@/hooks/useApiResource';
import { timesheetsApi } from '@/services/api/services';
import { formatDateRange } from '@/utils/date';

export default function MyTimesheetsTab({ reloadKey }: { reloadKey: number }) {
  const [page, setPage] = useState(0);
  const { data, loading, error, reload } = useApiResource(
    useCallback(() => timesheetsApi.mine({ page: page + 1, page_size: 12 }), [page]),
    [page, reloadKey],
  );

  // Grey placeholder rows while loading - the table's shape, not a full-width
  // blue bar under the tabs, which read as the tab underline gone wrong.
  if (loading) return <TableSkeleton rows={5} columns={5} />;
  if (error) return <ErrorAlert error={error} onRetry={reload} />;
  if (!data?.results.length) {
    return (
      <EmptyState
        title="No timesheets yet"
        detail="Book hours on the 'This week' tab; the sheet is created for you automatically."
      />
    );
  }

  return (
    <>
      <TableContainer sx={{ overflowX: 'auto' }}>
        {/* Fixed, evenly spread columns, all reading from the left. Comment is
            last and usually short (long ones are cut off, full text on hover),
            so it gets a modest share instead of a gap on the right. */}
        <Table size="small" sx={{ tableLayout: 'fixed', minWidth: 900 }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: '24%' }}>Week</TableCell>
              <TableCell sx={{ width: '14%' }}>Hours</TableCell>
              <TableCell sx={{ width: '16%' }}>Status</TableCell>
              <TableCell sx={{ width: '17%' }}>Submitted</TableCell>
              <TableCell sx={{ width: '17%' }}>Decided</TableCell>
              <TableCell>Comment</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.results.map((row) => (
              <TableRow key={row.id} hover>
                <TableCell>{formatDateRange(row.week_start_date, row.week_end_date)}</TableCell>
                <TableCell>{row.total_hours}</TableCell>
                <TableCell>
                  <StatusChip status={row.status} />
                </TableCell>
                <TableCell>
                  {row.submitted_at ? new Date(row.submitted_at).toLocaleDateString() : '-'}
                </TableCell>
                <TableCell>
                  {row.decided_at ? new Date(row.decided_at).toLocaleDateString() : '-'}
                </TableCell>
                <TableCell sx={{ overflowWrap: 'anywhere' }}>
                  <Typography variant="body2" noWrap title={row.decision_comment}>
                    {row.decision_comment || '-'}
                  </Typography>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        component="div"
        count={data.count}
        page={page}
        onPageChange={(_, next) => setPage(next)}
        rowsPerPage={12}
        rowsPerPageOptions={[12]}
      />
    </>
  );
}
