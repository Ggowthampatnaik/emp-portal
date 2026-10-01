/** My leave requests, with cancellation where the workflow still allows it. */

import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import LinearProgress from '@mui/material/LinearProgress';
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
import { EmptyState, ErrorAlert } from '@/components/common/Feedback';
import StatusChip from '@/components/common/StatusChip';
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

  if (loading) return <LinearProgress />;
  if (error) return <ErrorAlert error={error} onRetry={reload} />;
  if (!data?.results.length) {
    return (
      <EmptyState
        title="No leave requests yet"
        detail="Use 'Apply for leave' to submit your first request."
      />
    );
  }

  return (
    <>
      {cancel.error && <ErrorAlert error={cancel.error} />}
      <TableContainer sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell width={48} />
              <TableCell>Type</TableCell>
              <TableCell>From</TableCell>
              <TableCell>To</TableCell>
              <TableCell align="right">Days</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Decided by</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {data.results.map((row) => (
              <Fragment key={row.id}>
                <TableRow hover>
                  <TableCell>
                    <IconButton
                      size="small"
                      onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                      aria-label="Toggle details"
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
                  <TableCell align="right">{row.total_days}</TableCell>
                  <TableCell>
                    <StatusChip status={row.status} />
                  </TableCell>
                  <TableCell>{row.decided_by_name ?? '-'}</TableCell>
                  <TableCell align="right">
                    {row.can_cancel && (
                      <Button
                        size="small"
                        color="warning"
                        onClick={() => handleCancel(row)}
                        disabled={cancel.busy}
                      >
                        Cancel
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell colSpan={8} sx={{ py: 0, borderBottom: 0 }}>
                    <Collapse in={expanded === row.id} unmountOnExit>
                      <Stack spacing={1} sx={{ py: 2, pl: 6 }}>
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
