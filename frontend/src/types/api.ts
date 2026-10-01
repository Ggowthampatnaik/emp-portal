/** Shared API envelope types - one contract for every endpoint. */

export interface Paginated<T> {
  count: number;
  page: number;
  page_size: number;
  total_pages: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

/** Matches common/exceptions.py - every error looks like this. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    request_id: string;
    details?: Record<string, string[] | string>;
  };
}

export interface ApiError {
  code: string;
  message: string;
  requestId: string;
  /** Field-level errors, ready to feed straight into react-hook-form. */
  fieldErrors: Record<string, string>;
  status: number;
}

export interface ListParams {
  page?: number;
  page_size?: number;
  search?: string;
  ordering?: string;
  [key: string]: string | number | boolean | undefined;
}

/** The approval vocabulary shared by the leave and timesheet workflows. */
export const APPROVAL_STATUS = {
  DRAFT: 'draft',
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
} as const;

export type ApprovalStatus = (typeof APPROVAL_STATUS)[keyof typeof APPROVAL_STATUS];

/**
 * Leave has its own vocabulary: it is approved twice, by the manager and then
 * by HR. `approved`, `rejected` and `cancelled` keep the values they had when
 * leave and timesheets shared one enum.
 */
export const LEAVE_STATUS = {
  PENDING_MANAGER: 'pending_manager',
  PENDING_HR: 'pending_hr',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
} as const;

export type LeaveStatus = (typeof LEAVE_STATUS)[keyof typeof LEAVE_STATUS];

/** One stage's verdict. `sent_back` only ever appears on the HR stage. */
export type LeaveStageStatus = 'pending' | 'approved' | 'rejected' | 'sent_back';
