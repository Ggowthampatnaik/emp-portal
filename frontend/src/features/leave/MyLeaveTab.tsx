/** My leave requests, with cancellation where the workflow still allows it. */

import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { Fragment, useCallback, useState } from 'react';

import { useAppDispatch } from '@/app/hooks';
import { EmptyState, ErrorAlert, TableSkeleton } from '@/components/common/Feedback';
import { StatusText } from '@/components/common/StatusChip';
import LeaveStageTimeline from '@/features/leave/LeaveStageTimeline';
import { showToast } from '@/features/ui/uiSlice';
import { useApiAction, useApiResource } from '@/hooks/useApiResource';
import { leaveApi } from '@/services/api/services';
import type { LeaveRequest } from '@/types/domain';
import { formatDate } from '@/utils/date';

export default function MyLeaveTab({
  reloadKey,
  onChanged,
}: {
  reloadKey: number;
  onChanged: () => void;
}) {
  const dispatch = useAppDispatch();
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<number | null>(null);

  const { data, loading, error, reload } = useApiResource(
    useCallback(() => leaveApi.mine({ page: page + 1, page_size: 10 }), [page]),
    [page, reloadKey],
  );
  const cancel = useApiAction(leaveApi.cancel);

  const handleCancel = async (request: LeaveRequest) => {
    const updated = await cancel.run(request.id, 'Cancelled by the employee.');
    if (updated) {
      dispatch(showToast('Leave request cancelled.', 'info'));
      void reload();
      onChanged();
    }
  };

  // Grey placeholder rows while loading - the table's shape, not a full-width
  // blue bar under the tabs, which read as the tab underline gone wrong.
  if (loading) return <TableSkeleton rows={5} columns={6} />;
  if (error) return <ErrorAlert error={error} onRetry={reload} />;
  if (!data?.results.length) {
    return (
      <EmptyState
        title="No leave requests yet"
        detail="Use 'Apply for leave' to submit your first request."
      />
    );
  }

  // The Cancel column only appears when a request on this page can still be
  // cancelled; otherwise it was an empty strip down the right of the table.
  const anyCancellable = data.results.some((row) => row.can_cancel);
  const toggle = (id: number) => setExpanded((open) => (open === id ? null : id));
  const widths = anyCancellable
    ? { type: '20%', date: '15%', days: '10%', status: '15%' }
    : { type: '23%', date: '17%', days: '12%', status: '17%' };

  return (
    <>
      {cancel.error && <ErrorAlert error={cancel.error} />}
      <TableContainer sx={{ overflowX: 'auto' }}>
        {/* Fixed, evenly spread columns, all reading from the left. Decided by
            is last and holds only a name, so it gets just enough width and the
            spare goes between the other columns, not into a gap on the right. */}
        <Table size="small" sx={{ tableLayout: 'fixed', minWidth: 900 }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 56 }} />
              <TableCell sx={{ width: widths.type }}>Type</TableCell>
              <TableCell sx={{ width: widths.date }}>From</TableCell>
              <TableCell sx={{ width: widths.date }}>To</TableCell>
              <TableCell sx={{ width: widths.days }}>Days</TableCell>
              <TableCell sx={{ width: widths.status }}>Status</TableCell>
              <TableCell>Decided by</TableCell>
              {anyCancellable && <TableCell align="right" sx={{ width: 110 }} />}
            </TableRow>
          </TableHead>
          <TableBody>
            {data.results.map((row) => (
              <Fragment key={row.id}>
                {/* The whole row opens its details, not just the arrow. */}
                <TableRow
                  hover
                  onClick={() => toggle(row.id)}
                  sx={{ cursor: 'pointer' }}
                  selected={expanded === row.id}
                >
                  <TableCell>
                    <IconButton
                      size="small"
                      onClick={(event) => {
                        // The row toggles too; without this it would open and
                        // shut again in the same click.
                        event.stopPropagation();
                        toggle(row.id);
                      }}
                      aria-label="Toggle details"
                      aria-expanded={expanded === row.id}
                    >
                      {expanded === row.id ? (
                        <KeyboardArrowUpIcon />
                      ) : (
                        <KeyboardArrowDownIcon />
                      )}
                    </IconButton>
                  </TableCell>
                  <TableCell>{row.leave_type_name}</TableCell>
                  <TableCell>{formatDate(row.start_date)}</TableCell>
                  <TableCell>{formatDate(row.end_date)}</TableCell>
                  <TableCell>{row.total_days}</TableCell>
                  <TableCell>
                    <StatusText status={row.status} />
                  </TableCell>
                  <TableCell>{row.decided_by_name ?? '-'}</TableCell>
                  {anyCancellable && (
                    <TableCell align="right">
                      {row.can_cancel && (
                        // The one thing in the row you can press, so it keeps a
                        // button shape while the statuses are plain text; red.
                        <Chip
                          size="small"
                          color="error"
                          label="Cancel"
                          sx={{ width: 79 }}
                          onClick={(event) => {
                            // Cancelling is not a request to see the details.
                            event.stopPropagation();
                            void handleCancel(row);
                          }}
                          disabled={cancel.busy}
                          aria-label={`Cancel the ${row.leave_type_name} request`}
                        />
                      )}
                    </TableCell>
                  )}
                </TableRow>
                <TableRow>
                  <TableCell colSpan={anyCancellable ? 8 : 7} sx={{ py: 0, borderBottom: 0 }}>
                    <Collapse in={expanded === row.id} unmountOnExit>
                      <Stack spacing={1} sx={{ py: 2, pl: 7 }}>
                        <LeaveStageTimeline request={row} />
                        <Typography variant="body2">
                          <strong>Reason:</strong> {row.reason}
                        </Typography>
                        {row.cc_recipients.length > 0 && (
                          <Typography variant="body2">
                            <strong>Copied in:</strong>{' '}
                            {row.cc_recipients.map((entry) => entry.user_name).join(', ')}
                          </Typography>
                        )}
                        {row.decision_comment && (
                          <Typography variant="body2">
                            <strong>Decision comment:</strong> {row.decision_comment}
                          </Typography>
                        )}
                        <Typography variant="caption" color="text.secondary">
                          Applied {new Date(row.applied_at).toLocaleString()}
                          {row.decided_at
                            ? ` · decided ${new Date(row.decided_at).toLocaleString()}`
                            : ''}
                        </Typography>
                        {row.approvals.length > 0 && (
                          <Stack spacing={0.5}>
                            {row.approvals.map((entry) => (
                              <Typography
                                key={entry.id}
                                variant="caption"
                                color="text.secondary"
                              >
                                {entry.action} by {entry.actor_name ?? 'system'} —{' '}
                                {new Date(entry.created_at).toLocaleString()}
                                {entry.comment ? `: ${entry.comment}` : ''}
                              </Typography>
                            ))}
                          </Stack>
                        )}
                      </Stack>
                    </Collapse>
                  </TableCell>
                </TableRow>
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <TablePagination
        component="div"
        count={data.count}
        page={page}
        onPageChange={(_, next) => setPage(next)}
        rowsPerPage={10}
        rowsPerPageOptions={[10]}
      />
    </>
  );
}
