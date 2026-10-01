/**
 * Domain types, mirroring the DRF serializers one-for-one.
 *
 * Decimal fields arrive as strings (DRF renders DecimalField as a string to
 * avoid float rounding), so they are typed as string here and parsed only where
 * arithmetic is actually needed.
 */

import type { ApprovalStatus, LeaveStageStatus, LeaveStatus } from './api';
import type { RoleSlug } from './auth';

export type EmploymentStatus = 'active' | 'on_notice' | 'inactive';

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];

// --- Employees -------------------------------------------------------------
export interface Department {
  id: number;
  code: string;
  name: string;
  description: string;
  head: number | null;
  head_name: string | null;
  is_active: boolean;
  employee_count: number;
}

export interface Designation {
  id: number;
  code: string;
  name: string;
  level: number;
  description: string;
  is_active: boolean;
  employee_count: number;
}

export interface EmployeeListItem {
  id: number;
  employee_code: string;
  full_name: string;
  email: string;
  photo_url: string | null;
  department: number | null;
  department_name: string | null;
  designation: number | null;
  designation_name: string | null;
  reporting_manager: number | null;
  reporting_manager_name: string | null;
  date_of_joining: string;
  employment_status: EmploymentStatus;
  /** The portal account behind this employment record, and its roles. */
  user_id: number;
  roles: string[];
  work_location: string;
  phone: string;
  /**
   * How many company assets this person holds.
   *
   * Annotated by the employee list; `null` from endpoints that reuse this
   * shape without counting (`my-team`), which is not the same as zero.
   */
  asset_count: number | null;
}

/** A piece of company kit issued to an employee. */
export type AssetCondition = 'new' | 'good' | 'fair' | 'needs_repair';

export const ASSET_CONDITION_LABELS: Record<AssetCondition, string> = {
  new: 'New',
  good: 'Good',
  fair: 'Fair',
  needs_repair: 'Needs repair',
};

export interface EmployeeAsset {
  id: number;
  employee: number;
  name: string;
  brand: string;
  serial_number: string;
  /** Null until somebody photographs it; the file itself is write-only. */
  photo_url: string | null;
  /** Null for kit issued before the field existed - unknown, not "today". */
  issued_on: string | null;
  condition: AssetCondition;
  /**
   * Write responses only: what the photo's barcode decoded to, or null when
   * no barcode could be read. Lets the UI say where the serial came from.
   */
  barcode_serial?: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmployeeDocument {
  id: number;
  employee: number;
  document_type: string;
  title: string;
  file_url: string | null;
  file_size: number;
  content_type: string;
  uploaded_by_name: string | null;
  created_at: string;
}

export interface EmployeeDetail extends Omit<EmployeeListItem, 'full_name'> {
  first_name: string;
  last_name: string;
  full_name: string;
  roles: RoleSlug[];
  direct_report_count: number;
  photo_url: string | null;
  date_of_exit: string | null;
  date_of_birth: string | null;
  gender: string;
  blood_group: BloodGroup | '';
  permanent_address: string;
  current_address: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  /** False until the Complete Profile wizard is finished (F18). */
  profile_completed: boolean;
  documents: EmployeeDocument[];
  created_at: string;
  updated_at: string;
}

/** The company directory row - work contact details only. */
export interface DirectoryEntry {
  id: number;
  employee_code: string;
  full_name: string;
  email: string;
  department_name: string | null;
  designation_name: string | null;
  reporting_manager: number | null;
  reporting_manager_name: string | null;
  direct_report_count: number;
  date_of_joining: string;
  work_location: string;
  photo_url: string | null;
}

export interface DirectReport {
  id: number;
  employee_code: string;
  full_name: string;
  designation_name: string | null;
  photo_url: string | null;
}

/** One directory entry, expanded with the people who report to them. */
export interface DirectoryDetail extends DirectoryEntry {
  direct_reports: DirectReport[];
}

export interface OrgNode {
  id: number;
  employee_code: string;
  full_name: string;
  designation: string | null;
  department: string | null;
  photo_url: string | null;
  reports: OrgNode[];
}

// --- Projects --------------------------------------------------------------
export type ProjectStatus = 'planned' | 'active' | 'on_hold' | 'completed' | 'cancelled';

export interface ProjectMember {
  id: number;
  project: number;
  employee: number;
  employee_code: string;
  employee_name: string;
  designation: string | null;
  role_in_project: string;
  joined_on: string;
  left_on: string | null;
  is_active: boolean;
}

export interface ProjectAllocation {
  id: number;
  project: number;
  project_code: string;
  project_name: string;
  employee: number;
  employee_code: string;
  employee_name: string;
  allocation_percentage: string;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
}

export interface Project {
  id: number;
  code: string;
  name: string;
  client_name: string;
  department: number | null;
  department_name: string | null;
  project_manager: number | null;
  project_manager_name: string | null;
  status: ProjectStatus;
  start_date: string;
  end_date: string | null;
  is_billable: boolean;
  member_count: number;
  total_allocation: string;
}

export interface ProjectDetail extends Project {
  description: string;
  members: ProjectMember[];
  allocations: ProjectAllocation[];
  created_at: string;
  updated_at: string;
}

// --- Leave -----------------------------------------------------------------
export interface LeaveType {
  id: number;
  code: string;
  name: string;
  description: string;
  days_per_year: string;
  is_paid: boolean;
  requires_approval: boolean;
  max_consecutive_days: number | null;
  allow_half_day: boolean;
  carry_forward: boolean;
  is_active: boolean;
}

export interface Holiday {
  id: number;
  date: string;
  name: string;
  description: string;
  is_optional: boolean;
  day_of_week: string;
}

/** What an /holidays/import-docx/ upload did, row by row. */
export interface HolidayImportSummary {
  created: number;
  updated: number;
  unchanged: number;
  /** The first few lines that looked like holidays but could not be read. */
  skipped: string[];
  skipped_count: number;
  holidays: { date: string; name: string; is_optional: boolean }[];
}

export interface LeaveBalance {
  id: number;
  employee: number;
  employee_name: string;
  leave_type: number;
  leave_type_code: string;
  leave_type_name: string;
  year: number;
  allocated_days: string;
  carried_forward_days: string;
  entitled_days: string;
  used_days: string;
  pending_days: string;
  available_days: string;
}

export type DayPart = 'full' | 'first_half' | 'second_half';

export interface LeaveApprovalEntry {
  id: number;
  action: string;
  comment: string;
  actor_name: string | null;
  created_at: string;
}

export interface LeaveRequest {
  id: number;
  employee: number;
  employee_code: string;
  employee_name: string;
  department_name: string | null;
  leave_type: number;
  leave_type_name: string;
  start_date: string;
  end_date: string;
  day_part: DayPart;
  total_days: string;
  reason: string;
  contact_number: string;
  status: LeaveStatus;
  applied_at: string;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_comment: string;

  // Stage one - the reporting manager. Rejection happens here or not at all.
  manager_status: LeaveStageStatus;
  manager_decided_by_name: string | null;
  manager_decided_at: string | null;
  manager_comment: string;

  // Stage two - HR. Approve, or send back to the manager; never reject.
  hr_status: LeaveStageStatus;
  hr_decided_by_name: string | null;
  hr_decided_at: string | null;
  hr_comment: string;

  /** Whose desk it is on right now. */
  stage: 'manager' | 'hr' | 'closed';
  approvals: LeaveApprovalEntry[];
  cc_recipients: LeaveCCRecipient[];
  can_cancel: boolean;
}

export interface LeaveCCRecipient {
  id: number;
  user: number;
  user_name: string;
  email: string;
  employee_code: string | null;
  /** Null until the notification has actually gone out. */
  notified_at: string | null;
}

/** A queue row: the request plus the applicant's remaining balance. */
export interface LeaveQueueRow extends LeaveRequest {
  available_days: string | null;
  entitled_days: string | null;
  used_days: string | null;
}

/** One row of the people picker behind the CC field. */
export interface PersonSearchResult {
  id: number;
  /** The portal account - what CC is addressed to. */
  user_id: number;
  employee_code: string;
  full_name: string;
  email: string;
  designation_name: string | null;
  department_name: string | null;
  photo_url: string | null;
}

export interface ApplyLeavePayload {
  leave_type: number;
  start_date: string;
  end_date: string;
  day_part: DayPart;
  reason: string;
  /** Portal account ids, not employee ids. At most ten. */
  cc_user_ids?: number[];
}

// --- Payslip periods and release -------------------------------------------
/** One month that has a payslip, as the year/month drill-down lists it. */
export interface PayslipPeriodMonth {
  month: number;
  month_name: string;
  payslip_id: number;
  net_pay: string;
}

export interface PayslipPeriodYear {
  year: number;
  months: PayslipPeriodMonth[];
  total_net: string;
}

export interface PayslipPeriods {
  years: PayslipPeriodYear[];
}

export type PayslipApprovalStatus = 'pending' | 'processed' | 'approved' | 'queried';

/**
 * A payslip's journey from HR to Finance. Distinct from the *run* approval an
 * administrator gives: that one asks "is the month right?", this one asks
 * "should this person be paid now?".
 */
export interface PayslipApproval {
  id: number;
  payslip: number;
  /** Only on the detail response; the queue omits it. */
  payslip_detail?: Payslip;
  employee_name: string;
  employee_code: string;
  department_name: string | null;
  period_label: string;
  net_pay: string;
  status: PayslipApprovalStatus;
  status_label: string;
  awaits_finance: boolean;
  /** The person who sent it to Finance is the person being paid by it. */
  self_processed: boolean;
  processed_by_name: string | null;
  processed_at: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  comment: string;
}

// --- Onboarding ------------------------------------------------------------
/** Somewhere the employee worked before joining (F18). */
export interface ExperienceDetail {
  id: number;
  company_name: string;
  job_title: string;
  from_date: string;
  to_date: string | null;
  description: string;
  /** True when `to_date` is blank: the job ran until they joined here. */
  is_current: boolean;
}

export interface ExperienceDetailPayload {
  company_name: string;
  job_title: string;
  from_date: string;
  to_date?: string | null;
  description?: string;
}

// --- Account closure -------------------------------------------------------
/**
 * HR asks for an account to be closed; an administrator decides. "Deletion" is
 * the requirement's word, not what happens: approving **deactivates**, and the
 * person's leave, timesheets and payslips stay exactly where they are.
 */
export interface AccountDeletionRequest {
  id: number;
  employee: number;
  employee_code: string;
  employee_name: string;
  employee_email: string;
  department_name: string | null;
  designation_name: string | null;
  employment_status: EmploymentStatus;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  is_open: boolean;
  requested_by: number | null;
  requested_by_name: string | null;
  requested_at: string;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string;
}

// --- Bank details and skills -----------------------------------------------
export interface BankAccount {
  id: number;
  employee_code: string;
  account_holder_name: string;
  bank_name: string;
  branch_name: string;
  /** Present only when the owner reads their own record (decision D9). */
  account_number?: string;
  account_number_masked: string;
  ifsc_code: string;
  account_type: 'savings' | 'current' | 'salary';
  account_type_label: string;
  updated_by_name: string | null;
  updated_at: string;
}

export interface BankAccountPayload {
  account_holder_name: string;
  bank_name: string;
  branch_name: string;
  account_number: string;
  ifsc_code: string;
  account_type: string;
}

export type SkillCategory =
  'language' | 'framework' | 'database' | 'cloud' | 'tool' | 'domain' | 'soft' | 'other';

export interface Skill {
  id: number;
  name: string;
  category: SkillCategory;
  category_label: string;
  is_active: boolean;
  employee_count: number;
}

export type Proficiency = 'beginner' | 'intermediate' | 'advanced' | 'expert';

export interface EmployeeSkill {
  id: number;
  skill: number;
  skill_name: string;
  skill_category: SkillCategory;
  proficiency: Proficiency;
  years_of_experience: string | null;
}

export interface EmployeeSkillPayload {
  skill: number;
  proficiency?: Proficiency;
  years_of_experience?: string | null;
}

export const PROFICIENCIES: { value: Proficiency; label: string }[] = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
  { value: 'expert', label: 'Expert' },
];

// --- Timesheets ------------------------------------------------------------
export interface TimesheetEntry {
  id: number;
  project: number;
  project_code: string;
  project_name: string;
  work_date: string;
  hours: string;
  description: string;
  is_billable: boolean;
}

export interface TimesheetEntryPayload {
  project: number;
  work_date: string;
  hours: string;
  description?: string;
  is_billable?: boolean;
}

export interface TimesheetApprovalEntry {
  id: number;
  action: string;
  comment: string;
  actor_name: string | null;
  created_at: string;
}

export interface Timesheet {
  id: number;
  employee: number;
  employee_code: string;
  employee_name: string;
  department_name: string | null;
  week_start_date: string;
  week_end_date: string;
  status: ApprovalStatus;
  total_hours: string;
  comments: string;
  is_editable: boolean;
  submitted_at: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_comment: string;
  entries: TimesheetEntry[];
  approvals: TimesheetApprovalEntry[];
}

export interface TimesheetListItem {
  id: number;
  employee: number;
  employee_code: string;
  employee_name: string;
  department_name: string | null;
  week_start_date: string;
  week_end_date: string;
  status: ApprovalStatus;
  total_hours: string;
  submitted_at: string | null;
  decided_at: string | null;
  decision_comment: string;
}

export interface WeekSummary {
  hours: string;
  status: ApprovalStatus | null;
  week_start_date: string | null;
  timesheet_id: number | null;
}

/** One employee's submission state for a week, as HR sees it. */
export interface SubmissionStatusRow {
  employee_id: number;
  employee_code: string;
  employee_name: string;
  email: string;
  department_name: string | null;
  designation_name: string | null;
  timesheet_id: number | null;
  /** null when no sheet exists at all for that week. */
  status: ApprovalStatus | null;
  total_hours: string | null;
  /** True once it has left the employee's hands - pending or approved. */
  submitted: boolean;
}

export interface ProjectSubmissionRow {
  project_id: number;
  project_code: string;
  project_name: string;
  client_name: string;
  project_manager_name: string | null;
  team_size: number;
  submitted_count: number;
  pending_count: number;
  employees: SubmissionStatusRow[];
}

interface WeekEnvelope {
  week_start_date: string;
  week_end_date: string;
}

export interface ProjectSubmissionResponse extends WeekEnvelope {
  results: ProjectSubmissionRow[];
}

export interface EmployeeSubmissionResponse extends WeekEnvelope {
  submitted_count: number;
  pending_count: number;
  results: SubmissionStatusRow[];
}

export interface NotifyResult {
  week_start_date: string;
  /** Employee codes that were actually nudged; submitters are skipped. */
  notified: string[];
  count: number;
}

// --- Payroll ---------------------------------------------------------------
export type PayrollRunStatus = 'draft' | 'processed' | 'approved' | 'paid';

export interface SalaryStructure {
  id: number;
  employee: number;
  employee_code: string;
  employee_name: string;
  department_name: string | null;
  effective_from: string;
  effective_to: string | null;
  basic: string;
  hra: string;
  conveyance_allowance: string;
  medical_allowance: string;
  special_allowance: string;
  provident_fund: string;
  professional_tax: string;
  income_tax: string;
  other_deductions: string;
  gross_monthly: string;
  deductions_monthly: string;
  net_monthly: string;
  annual_ctc: string;
  is_current: boolean;
  notes: string;
  created_at: string;
}

export interface Payslip {
  id: number;
  run: number;
  run_status: PayrollRunStatus;
  period_label: string;
  year: number;
  month: number;
  employee: number;
  employee_code: string;
  employee_name: string;
  department_name: string | null;
  designation_name: string | null;
  working_days: number;
  lop_days: string;
  paid_days: string;
  basic: string;
  hra: string;
  conveyance_allowance: string;
  medical_allowance: string;
  special_allowance: string;
  provident_fund: string;
  professional_tax: string;
  income_tax: string;
  other_deductions: string;
  lop_amount: string;
  gross_earnings: string;
  total_deductions: string;
  net_pay: string;
  created_at: string;
}

export interface PayrollRun {
  id: number;
  year: number;
  month: number;
  month_name: string;
  period_label: string;
  status: PayrollRunStatus;
  notes: string;
  working_days: number;
  employee_count: number;
  total_gross: string;
  total_deductions: string;
  total_net: string;
  processed_by_name: string | null;
  processed_at: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  paid_at: string | null;
  is_locked: boolean;
  is_editable: boolean;
  created_at: string;
}

export interface PayrollRunDetail extends PayrollRun {
  payslips: Payslip[];
}

// --- Notifications ---------------------------------------------------------
export interface AppNotification {
  id: number;
  kind: string;
  level: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  link: string;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

// --- Reports & dashboard ---------------------------------------------------
export type ReportRow = Record<string, string | number>;

export interface ReportResponse {
  results: ReportRow[];
  [key: string]: unknown;
}

export interface UpcomingBirthday {
  id: number;
  employee_code: string;
  full_name: string;
  department_name: string | null;
  designation_name: string | null;
  photo_url: string | null;
  /** Day and month only - the birth year is never sent by the API. */
  day: number;
  month: number;
  celebrated_on: string;
  days_until: number;
  is_today: boolean;
}

export interface UpcomingHoliday {
  id: number;
  date: string;
  name: string;
  description: string;
  is_optional: boolean;
  day_of_week: string;
  days_until: number;
  is_today: boolean;
}

export interface DashboardSummary {
  as_of: string;
  horizon_days: number;
  upcoming_birthdays: UpcomingBirthday[];
  upcoming_holidays: UpcomingHoliday[];
  me?: {
    leave_entitled: string;
    leave_used: string;
    leave_pending: string;
    leave_available: string;
    week_hours: string;
    week_status: ApprovalStatus;
    timesheet_id: number | null;
    open_leave_requests: number;
    active_projects: number;
  };
  approvals?: {
    pending_leave: number;
    pending_timesheets: number;
    team_size: number;
  };
  organization?: {
    headcount: number;
    departments: number;
    active_projects: number;
    on_leave_today: number;
  };
}

// --- Administration --------------------------------------------------------
export interface AdminUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  is_active: boolean;
  must_change_password: boolean;
  roles: RoleSlug[];
  employee_code: string | null;
  department: string | null;
  last_login_at: string | null;
  created_at: string;
}

export interface Role {
  id: number;
  slug: RoleSlug;
  name: string;
  description: string;
  is_system: boolean;
  permissions: string[];
}

export interface SystemSetting {
  id: number;
  key: string;
  value: string;
  value_type: 'string' | 'integer' | 'decimal' | 'boolean';
  typed_value: string;
  description: string;
  is_editable: boolean;
  updated_at: string;
}

export interface AuditLogEntry {
  id: number;
  actor: number | null;
  actor_name: string | null;
  actor_email: string;
  action: string;
  entity_type: string;
  entity_id: string;
  entity_label: string;
  changes: Record<string, unknown>;
  ip_address: string | null;
  request_id: string;
  created_at: string;
}
