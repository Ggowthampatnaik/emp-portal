/**
 * One leave type, in full: the sum that produces the balance, and the requests
 * that spent it.
 *
 * The card answers "how many days do I have left". The obvious next questions
 * are "where did the rest go" and "how did I get that number", and neither
 * fits on a card sitting in a row of four. The arithmetic is laid out in the
 * order it happens - allocated, carried forward, entitled, less used, less
 * pending, leaves available - so a number somebody disputes can be traced.
 */

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import Divider from '@mui/material/Divider';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useCallback } from 'react';

import ClosableDialogTitle from '@/components/common/ClosableDialogTitle';
import { ErrorAlert } from '@/components/common/Feedback';
import StatusChip from '@/components/common/StatusChip';
import { useApiResource } from '@/hooks/useApiResource';
import { leaveApi } from '@/services/api/services';
import type { LeaveBalance } from '@/types/domain';
import { formatDateRange } from '@/utils/date';

/** One line of the sum, so the arithmetic can be read down the column. */
function Line({
  label,
  value,
  strong,
  note,
}: {
  label: string;
  value: string;
  strong?: boolean;
  note?: string;
}) {
  return (
    <Stack
      direction="row"
      justifyContent="space-between"
      alignItems="baseline"
      sx={{ py: 0.75 }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" fontWeight={strong ? 700 : 400}>
          {label}
        </Typography>
        {note && (
          <Typography variant="caption" color="text.secondary">
            {note}
          </Typography>
        )}
      </Box>
      <Typography
        variant="body2"
        fontWeight={strong ? 700 : 600}
        sx={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0, pl: 2 }}
      >
        {value}
      </Typography>
    </Stack>
  );
}

export default function LeaveBalanceDialog({
  balance,
  onClose,
  onOpenRequests,
}: {
  balance: LeaveBalance | null;
  onClose: () => void;
  /** Takes the reader to the full list, filtered by nothing - all of it. */
  onOpenRequests?: () => void;
}) {
  // The caller's own requests. Filtered here rather than by the API, which
  // takes no leave-type filter on this route - one person's leave history is
  // a short list.
  const fetcher = useCallback(
    () => (balance ? leaveApi.mine({ page_size: 100 }) : Promise.resolve(null)),
    [balance],
  );
  const { data, loading, error, reload } = useApiResource(fetcher, [balance?.id]);

  const requests = (data?.results ?? []).filter(
    (row) =>
      row.leave_type === balance?.leave_type &&
      Number(row.start_date.slice(0, 4)) === balance?.year,
  );

  const entitled = Number(balance?.entitled_days ?? 0);
  const used = Number(balance?.used_days ?? 0);
  const pending = Number(balance?.pending_days ?? 0);
  const usedPercent = entitled > 0 ? (used / entitled) * 100 : 0;
  const pendingPercent = entitled > 0 ? (pending / entitled) * 100 : 0;

  return (
    <Dialog open={Boolean(balance)} onClose={onClose} fullWidth maxWidth="sm">
      <ClosableDialogTitle onClose={onClose}>
        {balance?.leave_type_name ?? 'Leave'}
      </ClosableDialogTitle>

      <DialogContent dividers>
        {balance && (
          <Stack spacing={2.5}>
            <Stack direction="row" spacing={1.5} alignItems="baseline">
              <Typography
                variant="h2"
                component="p"
                sx={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {balance.available_days}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                days available in {balance.year}
              </Typography>
              <Box sx={{ flexGrow: 1 }} />
              <Chip size="small" variant="outlined" label={balance.leave_type_code} />
            </Stack>

            {/* Same two-segment bar as the card: blue for spent, amber for the
                sliver awaiting a decision. Skipped at zero entitlement, where
                a full-width track would read as a full bar. */}
            {entitled > 0 ? (
              <Box sx={{ position: 'relative' }}>
                <LinearProgress
                  variant="determinate"
                  value={Math.min(100, usedPercent + pendingPercent)}
                  color="warning"
                  sx={{ height: 8, borderRadius: 4, backgroundColor: 'divider' }}
                />
                <LinearProgress
                  variant="determinate"
                  value={Math.min(100, usedPercent)}
                  color="primary"
                  sx={{
                    height: 8,
                    borderRadius: 4,
                    position: 'absolute',
                    inset: 0,
                    backgroundColor: 'transparent',
                  }}
                />
              </Box>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No entitlement — this type is taken as unpaid, so there is no balance to spend.
              </Typography>
            )}

            <Box>
              <Typography variant="subtitle2" gutterBottom>
                How the balance is made up
              </Typography>
              <Stack divider={<Divider flexItem />}>
                <Line label="Allocated this year" value={balance.allocated_days} />
                <Line
                  label="Carried forward"
                  value={balance.carried_forward_days}
                  note={
                    Number(balance.carried_forward_days) > 0
                      ? `Unused days brought in from ${balance.year - 1}`
                      : undefined
                  }
                />
                <Line label="Entitled" value={balance.entitled_days} strong />
                <Line label="Used" value={`− ${balance.used_days}`} note="Approved and taken" />
                <Line
                  label="Pending"
                  value={`− ${balance.pending_days}`}
                  note="Requested, not yet decided"
                />
                <Line label="Available" value={balance.available_days} strong />
              </Stack>
            </Box>

            <Box>
              <Typography variant="subtitle2" gutterBottom>
                {balance.leave_type_name} requests in {balance.year}
              </Typography>

              {error && <ErrorAlert error={error} onRetry={reload} />}
              {loading && <LinearProgress />}

              {!loading && !error && requests.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  You have not requested any {balance.leave_type_name.toLowerCase()} this year.
                </Typography>
              )}

              {requests.length > 0 && (
                <Stack divider={<Divider flexItem />}>
                  {requests.map((row) => (
                    <Stack
                      key={row.id}
                      direction="row"
                      spacing={2}
                      alignItems="center"
                      sx={{ py: 1 }}
                    >
                      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                        <Typography variant="body2">
                          {formatDateRange(row.start_date, row.end_date)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap>
                          {row.reason}
                        </Typography>
                      </Box>
                      <Typography
                        variant="body2"
                        sx={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}
                      >
                        {row.total_days} d
                      </Typography>
                      <StatusChip status={row.status} />
                    </Stack>
                  ))}
                </Stack>
              )}
            </Box>
          </Stack>
        )}
      </DialogContent>

      <DialogActions>
        {onOpenRequests && (
          <Button
            onClick={() => {
              onClose();
              onOpenRequests();
            }}
          >
            All my requests
          </Button>
        )}
        <Box sx={{ flexGrow: 1 }} />
        <Button variant="contained" onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
