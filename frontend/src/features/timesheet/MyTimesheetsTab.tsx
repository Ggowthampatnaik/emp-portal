/** My timesheet history. */

import LinearProgress from '@mui/material/LinearProgress';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useCallback, useState } from 'react';

import { EmptyState, ErrorAlert } from '@/components/common/Feedback';
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

  if (loading) return <LinearProgress />;
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
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Week</TableCell>
              <TableCell align="right">Hours</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Submitted</TableCell>
              <TableCell>Decided</TableCell>
              <TableCell>Comment</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.results.map((row) => (
              <TableRow key={row.id} hover>
                <TableCell>{formatDateRange(row.week_start_date, row.week_end_date)}</TableCell>
                <TableCell align="right">{row.total_hours}</TableCell>
                <TableCell>
                  <StatusChip status={row.status} />
                </TableCell>
                <TableCell>
                  {row.submitted_at ? new Date(row.submitted_at).toLocaleDateString() : '-'}
                </TableCell>
                <TableCell>
                  {row.decided_at ? new Date(row.decided_at).toLocaleDateString() : '-'}
                </TableCell>
                <TableCell sx={{ maxWidth: 260 }}>
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
