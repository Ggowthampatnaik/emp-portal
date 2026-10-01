/**
 * Where a leave request has got to, as two steps.
 *
 * Employees ask "has it been approved?" and the honest answer since Phase 3 is
 * "by whom?" — the manager approving is not the end of it, and the balance is
 * not touched until HR confirms. Showing both stages side by side is what stops
 * that being a surprise.
 */

import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import UndoIcon from '@mui/icons-material/Undo';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import type { LeaveStageStatus } from '@/types/api';
import type { LeaveRequest } from '@/types/domain';

const ICONS: Record<LeaveStageStatus, typeof CheckCircleIcon> = {
  approved: CheckCircleIcon,
  rejected: CancelIcon,
  sent_back: UndoIcon,
  pending: HourglassEmptyIcon,
};

const COLORS: Record<LeaveStageStatus, string> = {
  approved: 'success.main',
  rejected: 'error.main',
  sent_back: 'warning.main',
  pending: 'text.disabled',
};

const WORDING: Record<LeaveStageStatus, string> = {
  pending: 'Waiting',
  approved: 'Approved',
  rejected: 'Rejected',
  sent_back: 'Sent back',
};

function Stage({
  label,
  status,
  actor,
  at,
  comment,
  waitingFor,
}: {
  label: string;
  status: LeaveStageStatus;
  actor: string | null;
  at: string | null;
  comment: string;
  /** Shown instead of "Waiting" when this stage has not been reached yet. */
  waitingFor?: string;
}) {
  const Icon = ICONS[status];

  return (
    <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ minWidth: 0, flex: 1 }}>
      <Icon fontSize="small" sx={{ color: COLORS[status], mt: 0.25 }} />
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary" display="block">
          {label}
        </Typography>
        <Typography variant="body2" fontWeight={600}>
          {status === 'pending' ? (waitingFor ?? WORDING.pending) : WORDING[status]}
          {actor && status !== 'pending' ? ` — ${actor}` : ''}
        </Typography>
        {at && status !== 'pending' && (
          <Typography variant="caption" color="text.secondary" display="block">
            {new Date(at).toLocaleString()}
          </Typography>
        )}
        {comment && (
          <Typography variant="caption" color="text.secondary" display="block">
            “{comment}”
          </Typography>
        )}
      </Box>
    </Stack>
  );
}

export default function LeaveStageTimeline({ request }: { request: LeaveRequest }) {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={2}
      divider={
        <Box
          sx={{
            width: { xs: 0, sm: 24 },
            height: { xs: 0, sm: 1 },
            alignSelf: 'center',
            borderTop: { sm: 1 },
            borderColor: 'divider',
          }}
        />
      }
      sx={{ py: 1 }}
    >
      <Stage
        label="1 · Reporting manager"
        status={request.manager_status}
        actor={request.manager_decided_by_name}
        at={request.manager_decided_at}
        comment={request.manager_comment}
      />
      <Stage
        label="2 · HR"
        status={request.hr_status}
        actor={request.hr_decided_by_name}
        at={request.hr_decided_at}
        comment={request.hr_comment}
        waitingFor={
          request.stage === 'manager' ? 'Not yet — with your manager' : 'Waiting with HR'
        }
      />
    </Stack>
  );
}
