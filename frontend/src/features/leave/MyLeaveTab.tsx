/** My leave requests, with cancellation where the workflow still allows it. */

import Box from '@mui/material/Box';
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
import ApplyLeaveDialog from '@/features/leave/ApplyLeaveDialog';
import LeaveStageTimeline from '@/features/leave/LeaveStageTimeline';
import { showToast } from '@/features/ui/uiSlice';
import { useApiAction, useApiResource } from '@/hooks/useApiResource';
import { leaveApi } from '@/services/api/services';
import type { LeaveRequest } from '@/types/domain';
import { formatDate } from '@/utils/date';

/** Column widths, shared by the table and the grid inside an opened request. */
const COL = { expander: 56, type: '23%', date: '17%', days: '12%', status: '17%' } as const;

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
  const [editing, setEditing] = useState<LeaveRequest | null>(null);

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

  const toggle = (id: number) => setExpanded((open) => (open === id ? null : id));

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
              <TableCell sx={{ width: COL.expander }} />
              <TableCell sx={{ width: COL.type }}>Type</TableCell>
              <TableCell sx={{ width: COL.date }}>From</TableCell>
              <TableCell sx={{ width: COL.date }}>To</TableCell>
              <TableCell sx={{ width: COL.days }}>Days</TableCell>
              <TableCell sx={{ width: COL.status }}>Status</TableCell>
              <TableCell>Decided by</TableCell>
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
                </TableRow>
                <TableRow>
                  <TableCell colSpan={7} sx={{ p: 0, borderBottom: 0 }}>
                    <Collapse in={expanded === row.id} unmountOnExit>
                      {/* The table's own columns, all on one row: the details under
                          Type to Days, Edit under Status and Cancel under Decided
                          by, level with the approval steps. Without the shared
                          row, the buttons wrapped below everything else. */}
                      <Box
                        sx={{
                          display: 'grid',
                          gridTemplateColumns: `${COL.expander}px ${COL.type} ${COL.date} ${COL.date} ${COL.days} ${COL.status} 1fr`,
                        }}
                      >
                        <Stack
                          spacing={1}
                          sx={{ gridColumn: '2 / 6', gridRow: 1, py: 2, px: 2 }}
                        >
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
                        <Box sx={{ gridColumn: '6', gridRow: 1, pt: 2, px: 2 }}>
                          {row.can_edit && (
                            // Under Status: changeable only while it is still
                            // with the manager.
                            <Chip
                              size="small"
                              color="primary"
                              label="Edit"
                              sx={{ width: 79 }}
                              onClick={() => setEditing(row)}
                              aria-label={`Edit the ${row.leave_type_name} request`}
                            />
                          )}
                        </Box>
                        <Box sx={{ gridColumn: '7', gridRow: 1, pt: 2, px: 2 }}>
                          {row.can_cancel && (
                            // Inside the request it cancels, under Decided by.
                            <Chip
                              size="small"
                              color="error"
                              label="Cancel"
                              sx={{ width: 79 }}
                              onClick={() => void handleCancel(row)}
                              disabled={cancel.busy}
                              aria-label={`Cancel the ${row.leave_type_name} request`}
                            />
                          )}
                        </Box>
                      </Box>
                    </Collapse>
                  </TableCell>
                </TableRow>
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {editing && (
        <ApplyLeaveDialog
          key={editing.id}
          open
          editing={editing}
          onClose={() => setEditing(null)}
          onApplied={() => {
            setEditing(null);
            void reload();
            onChanged();
          }}
        />
      )}

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
