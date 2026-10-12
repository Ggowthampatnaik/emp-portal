import Chip from '@mui/material/Chip';
import type { ChipProps } from '@mui/material/Chip';
import Typography from '@mui/material/Typography';

import type { ApprovalStatus } from '@/types/api';
import type { EmploymentStatus, ProjectStatus } from '@/types/domain';

type AnyStatus = ApprovalStatus | EmploymentStatus | ProjectStatus | string;

const COLOR: Record<string, ChipProps['color']> = {
  // approval workflow
  draft: 'default',
  pending: 'warning',
  // leave is approved twice: by the manager, then by HR
  pending_manager: 'warning',
  pending_hr: 'info',
  approved: 'success',
  rejected: 'error',
  cancelled: 'default',
  // employment
  active: 'success',
  on_notice: 'warning',
  inactive: 'default',
  // projects
  planned: 'info',
  on_hold: 'warning',
  completed: 'primary',
};

const LABEL: Record<string, string> = {
  draft: 'Draft',
  pending: 'Pending',
  pending_manager: 'With manager',
  pending_hr: 'With HR',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  active: 'Active',
  on_notice: 'On notice',
  inactive: 'Inactive',
  planned: 'Planned',
  on_hold: 'On hold',
  completed: 'Completed',
};

interface Props {
  status: AnyStatus;
  size?: ChipProps['size'];
  /**
   * A fixed width in px, so a column of statuses lines up as one set of
   * same-sized pills instead of each one sized to its word.
   */
  width?: number;
}

/** One consistent status pill everywhere a workflow or lifecycle state appears. */
export default function StatusChip({ status, size = 'small', width }: Props) {
  return (
    <Chip
      sx={width ? { width } : undefined}
      size={size}
      label={LABEL[status] ?? status}
      color={COLOR[status] ?? 'default'}
      variant={
        status === 'draft' || status === 'inactive' || status === 'pending_manager'
          ? 'outlined'
          : 'filled'
      }
    />
  );
}

/**
 * The status as plain words, no pill and no colour: the same labels as
 * StatusChip, for tables that want a quiet column rather than a row of badges.
 */
export function StatusText({ status }: { status: AnyStatus }) {
  return (
    <Typography variant="body2" fontWeight={600} color="text.secondary" component="span">
      {LABEL[status] ?? status}
    </Typography>
  );
}
