import Chip from '@mui/material/Chip';
import type { ChipProps } from '@mui/material/Chip';

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
}

/** One consistent status pill everywhere a workflow or lifecycle state appears. */
export default function StatusChip({ status, size = 'small' }: Props) {
  return (
    <Chip
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
