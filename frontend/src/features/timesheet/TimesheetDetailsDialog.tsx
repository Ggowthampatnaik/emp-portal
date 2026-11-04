/**
 * One person's timesheet for one week, opened from the Submissions board.
 *
 * Read-only: HR looks, it does not edit someone else's hours. A person with no
 * timesheet at all for the week has nothing to load, so the dialog says so
 * rather than fetching.
 */

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useCallback } from 'react';

import ClosableDialogTitle from '@/components/common/ClosableDialogTitle';
import { ErrorAlert, TableSkeleton } from '@/components/common/Feedback';
import { useApiResource } from '@/hooks/useApiResource';
import { timesheetsApi } from '@/services/api/services';
import type { SubmissionStatusRow } from '@/types/domain';
import { formatDate, formatDateRange, formatDateTime } from '@/utils/date';

const STATUS: Record<
  string,
  { label: string; color: 'default' | 'info' | 'success' | 'error' }
> = {
  draft: { label: 'Draft only', color: 'default' },
  pending: { label: 'Submitted', color: 'info' },
  approved: { label: 'Approved', color: 'success' },
  rejected: { label: 'Returned', color: 'error' },
};

export default function TimesheetDetailsDialog({
  row,
  weekStart,
  weekEnd,
  onClose,
}: {
  row: SubmissionStatusRow;
  weekStart: string;
  weekEnd: string;
  onClose: () => void;
}) {
  const sheetId = row.timesheet_id;
  const { data, loading, error, reload } = useApiResource(
    useCallback(
      () => (sheetId ? timesheetsApi.detail(sheetId) : Promise.resolve(null)),
      [sheetId],
    ),
    [sheetId],
  );

  const status = STATUS[data?.status ?? row.status ?? ''];
  const entries = [...(data?.entries ?? [])].sort(
    (a, b) =>
      a.work_date.localeCompare(b.work_date) || a.project_code.localeCompare(b.project_code),
  );

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <ClosableDialogTitle
        onClose={onClose}
        subtitle={`${row.employee_code}${row.department_name ? ` · ${row.department_name}` : ''} · ${formatDateRange(weekStart, weekEnd)}`}
      >
        {row.employee_name}&apos;s timesheet
      </ClosableDialogTitle>
      <DialogContent dividers>
        {!sheetId ? (
          <Alert severity="warning">
            No timesheet has been started for this week - there are no hours to show.
          </Alert>
        ) : error ? (
          <ErrorAlert error={error} onRetry={reload} />
        ) : loading || !data ? (
          <TableSkeleton rows={5} columns={4} />
        ) : (
          <Stack spacing={2}>
            <Stack direction="row" spacing={3} alignItems="center" flexWrap="wrap" useFlexGap>
              <Box>
                <Typography variant="caption" color="text.secondary" display="block">
                  Status
                </Typography>
                {status ? (
                  <Chip size="small" color={status.color} label={status.label} />
                ) : (
                  <Typography variant="body2">{data.status}</Typography>
                )}
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary" display="block">
                  Total hours
                </Typography>
                <Typography variant="body2" fontWeight={600}>
                  {Number(data.total_hours).toFixed(2)} h
                </Typography>
              </Box>
              {data.submitted_at && (
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Submitted
                  </Typography>
                  <Typography variant="body2">{formatDateTime(data.submitted_at)}</Typography>
                </Box>
              )}
              {data.decided_by_name && (
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Decided by
                  </Typography>
                  <Typography variant="body2">{data.decided_by_name}</Typography>
                </Box>
              )}
            </Stack>

            {entries.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Nothing has been booked on this timesheet yet.
              </Typography>
            ) : (
              <Table size="small" sx={{ tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: '20%' }} />
                  <col style={{ width: '24%' }} />
                  <col />
                  <col style={{ width: 90 }} />
                </colgroup>
                <TableHead>
                  <TableRow>
                    <TableCell>Date</TableCell>
                    <TableCell>Project</TableCell>
                    <TableCell>Task description</TableCell>
                    <TableCell>Hours</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        {formatDate(entry.work_date)}
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{entry.project_code}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {entry.project_name}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography
                          variant="body2"
                          color={entry.description ? 'text.primary' : 'text.disabled'}
                        >
                          {entry.description || 'No description given'}
                        </Typography>
                      </TableCell>
                      <TableCell>{Number(entry.hours).toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {data.comments && (
              <Typography variant="body2">
                <strong>Employee note:</strong> {data.comments}
              </Typography>
            )}
            {data.decision_comment && (
              <Typography variant="body2">
                <strong>Decision comment:</strong> {data.decision_comment}
              </Typography>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
