/**
 * My leave balances, with entitlement usage.
 *
 * Entitlement is held per calendar year, so booking January's holiday in
 * December draws on *next* year's allowance. The year selector exists because
 * without it this page silently showed only the current year while the request
 * being made was counted against another one.
 */

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useState } from 'react';

import { CardGridSkeleton, EmptyState, ErrorAlert } from '@/components/common/Feedback';
import { useApiResource } from '@/hooks/useApiResource';
import { identityChipSx, identityHue } from '@/styles/identity';
import LeaveBalanceDialog from '@/features/leave/LeaveBalanceDialog';
import { leaveApi } from '@/services/api/services';
import type { LeaveBalance } from '@/types/domain';

const THIS_YEAR = new Date().getFullYear();
/** Last year for reference, this year to use, next year to plan. */
const YEARS = [THIS_YEAR - 1, THIS_YEAR, THIS_YEAR + 1];

export default function LeaveBalancesTab({
  reloadKey,
  onOpenRequests,
}: {
  reloadKey: number;
  /** Opens the My requests tab - what a balance card is really asking about. */
  onOpenRequests?: () => void;
}) {
  const [year, setYear] = useState(THIS_YEAR);
  /** The balance whose detail is open. */
  const [selected, setSelected] = useState<LeaveBalance | null>(null);
  const { data, loading, error, reload } = useApiResource(
    useCallback(() => leaveApi.myBalances(year), [year]),
    [reloadKey, year],
  );

  const yearPicker = (
    <Stack direction="row" spacing={2} alignItems="center" sx={{ px: 2, pt: 2 }}>
      <TextField
        select
        size="small"
        label="Year"
        value={year}
        onChange={(event) => setYear(Number(event.target.value))}
        sx={{ minWidth: 140 }}
      >
        {YEARS.map((option) => (
          <MenuItem key={option} value={option}>
            {option}
            {option === THIS_YEAR ? ' (this year)' : ''}
          </MenuItem>
        ))}
      </TextField>
      {year !== THIS_YEAR && (
        <Typography variant="body2" color="text.secondary">
          Leave taken in {year} counts against {year}'s entitlement.
        </Typography>
      )}
    </Stack>
  );

  if (loading) {
    return (
      <>
        {yearPicker}
        <Box sx={{ p: 2 }}>
          <CardGridSkeleton cards={5} height={170} />
        </Box>
      </>
    );
  }
  if (error) return <ErrorAlert error={error} onRetry={reload} />;
  if (!data?.length) {
    return (
      <>
        {yearPicker}
        <EmptyState
          title={`No leave balances for ${year}`}
          detail="Balances open automatically once HR has set up your employee record and the leave policies."
        />
      </>
    );
  }

  return (
    <>
      {yearPicker}
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          p: 2,
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' },
        }}
      >
        {data.map((balance) => {
          const entitled = Number(balance.entitled_days);
          const used = Number(balance.used_days);
          const pending = Number(balance.pending_days);
          const usedPercent = entitled > 0 ? (used / entitled) * 100 : 0;
          const pendingPercent = entitled > 0 ? (pending / entitled) * 100 : 0;

          return (
            <Card
              key={balance.id}
              variant="outlined"
              // A rail in the leave type's own colour. Five white cards in a
              // row were told apart only by reading their headings; this makes
              // the set scannable, and matches the code chip opposite so the
              // two cannot drift apart.
              sx={{
                position: 'relative',
                overflow: 'hidden',
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  insetBlock: 0,
                  left: 0,
                  width: 4,
                  bgcolor: identityHue(balance.leave_type_name),
                },
              }}
            >
              {/* The card answers "how many days do I have"; the obvious next
                  questions - where the rest went, and how the number was
                  reached - open here rather than sending the reader to
                  another tab to work it out. */}
              <CardActionArea
                onClick={() => setSelected(balance)}
                aria-label={`${balance.leave_type_name}: ${balance.available_days} days available`}
                sx={{ height: '100%', display: 'block', textAlign: 'left' }}
              >
                <CardContent>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="h4">{balance.leave_type_name}</Typography>
                    <Chip
                      size="small"
                      label={balance.leave_type_code}
                      sx={identityChipSx(balance.leave_type_name)}
                    />
                  </Stack>

                  <Stack direction="row" spacing={1} alignItems="baseline" sx={{ mt: 1.5 }}>
                    <Typography variant="h2" component="p">
                      {balance.available_days}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      of {balance.entitled_days} days available
                    </Typography>
                  </Stack>

                  {/* Used (blue) and pending (amber) against a neutral track.
                    The track is explicitly neutral: the warning-coloured bar
                    used to paint its own amber track, which flooded every
                    untouched balance with the one colour the rest of the
                    portal reserves for "needs attention". Amber now appears
                    only for the sliver that is actually pending a decision.
                    Skipped entirely at zero entitlement: a bar drawn against
                    nothing still paints its full-width track, so Loss of Pay
                    - which is 0 of 0 by definition - read as a completely
                    full bar, the exact opposite of the truth. */}
                  {entitled > 0 ? (
                    <Box sx={{ position: 'relative', mt: 1.5 }}>
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
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ mt: 1.5, display: 'block' }}
                    >
                      No entitlement — taken as unpaid.
                    </Typography>
                  )}

                  <Stack direction="row" spacing={2} sx={{ mt: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">
                      Used <strong>{balance.used_days}</strong>
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Pending <strong>{balance.pending_days}</strong>
                    </Typography>
                    {Number(balance.carried_forward_days) > 0 && (
                      <Typography variant="caption" color="text.secondary">
                        Carried <strong>{balance.carried_forward_days}</strong>
                      </Typography>
                    )}
                  </Stack>
                </CardContent>
              </CardActionArea>
            </Card>
          );
        })}
      </Box>

      <LeaveBalanceDialog
        balance={selected}
        onClose={() => setSelected(null)}
        onOpenRequests={onOpenRequests}
      />
    </>
  );
}
