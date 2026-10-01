/**
 * Typed API surface, one object per module. Feature components call these
 * instead of touching axios, so a route change is a one-line edit here and in
 * endpoints.ts.
 */

import { http } from '@/services/api/client';
import { endpoints } from '@/services/api/endpoints';
import type { ListParams, Paginated } from '@/types/api';
import type {
  AccountDeletionRequest,
  AdminUser,
  AppNotification,
  ApplyLeavePayload,
  AuditLogEntry,
  BankAccount,
  BankAccountPayload,
  DashboardSummary,
  Department,
  Designation,
  DirectoryDetail,
  DirectoryEntry,
  EmployeeAsset,
  EmployeeDetail,
  EmployeeDocument,
  EmployeeListItem,
  EmployeeSkill,
  EmployeeSkillPayload,
  EmployeeSubmissionResponse,
  ExperienceDetail,
  ExperienceDetailPayload,
  Holiday,
  HolidayImportSummary,
  LeaveBalance,
  LeaveQueueRow,
  LeaveRequest,
  LeaveType,
  NotifyResult,
  OrgNode,
  PayrollRun,
  PayrollRunDetail,
  Payslip,
  PayslipApproval,
  PayslipPeriods,
  PersonSearchResult,
  Project,
  ProjectAllocation,
  ProjectDetail,
  ProjectMember,
  ProjectSubmissionResponse,
  ReportResponse,
  Role,
  SalaryStructure,
  Skill,
  SystemSetting,
  Timesheet,
  TimesheetEntryPayload,
  TimesheetListItem,
  UpcomingBirthday,
  WeekSummary,
} from '@/types/domain';

/** Strips undefined values so they never reach the query string. */
function query(params?: ListParams): Record<string, string | number | boolean> {
  const clean: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== '' && value !== null) clean[key] = value;
  }
  return clean;
}

export const employeesApi = {
  list: (params?: ListParams) =>
    http.get<Paginated<EmployeeListItem>>(endpoints.employees.list, { params: query(params) }),
  detail: (id: number | string) => http.get<EmployeeDetail>(endpoints.employees.detail(id)),
  me: () => http.get<EmployeeDetail>(endpoints.employees.me),
  myTeam: () => http.get<EmployeeListItem[]>(endpoints.employees.myTeam),
  orgChart: () => http.get<OrgNode[]>(endpoints.employees.orgChart),
  directory: (params?: ListParams) =>
    http.get<Paginated<DirectoryEntry>>(endpoints.employees.directory, {
      params: query(params),
    }),
  directoryEntry: (id: number | string) =>
    http.get<DirectoryDetail>(endpoints.employees.directoryEntry(id)),
  create: (body: Record<string, unknown>) =>
    http.post<EmployeeDetail>(endpoints.employees.list, body),
  update: (id: number | string, body: Record<string, unknown>) =>
    http.patch<EmployeeDetail>(endpoints.employees.detail(id), body),
  deactivate: (id: number | string) => http.delete<void>(endpoints.employees.detail(id)),
  documents: (id: number | string) =>
    http.get<EmployeeDocument[]>(endpoints.employees.documents(id)),

  // Bank details. The full account number comes back only when the owner reads
  // their own record; everyone else gets `account_number_masked`.
  bankAccount: (id: number | string) =>
    http.get<BankAccount>(endpoints.employees.bankAccount(id)),
  saveBankAccount: (id: number | string, body: BankAccountPayload) =>
    http.put<BankAccount>(endpoints.employees.bankAccount(id), body),
  deleteBankAccount: (id: number | string) =>
    http.delete<void>(endpoints.employees.bankAccount(id)),

  /** Type-ahead for people pickers. Matches a prefix of a name or code. */
  search: (q: string) =>
    http.get<PersonSearchResult[]>(endpoints.employees.search, { params: query({ q }) }),

  // Account closure. HR raises it here; an administrator decides in
  // Administration. Approving deactivates - nothing is ever deleted.
  deletionRequest: (id: number | string) =>
    http.get<AccountDeletionRequest>(endpoints.employees.deletionRequest(id)),
  requestDeletion: (id: number | string, reason: string) =>
    http.post<AccountDeletionRequest>(endpoints.employees.deletionRequest(id), { reason }),
  withdrawDeletion: (id: number | string) =>
    http.delete<void>(endpoints.employees.deletionRequest(id)),

  /** The Complete Profile step a new employee must finish (F18). */
  completeProfile: (id: number | string, body: Record<string, unknown>) =>
    http.post<EmployeeDetail>(endpoints.employees.completeProfile(id), body),
  profileDraft: (id: number | string, body: Record<string, unknown>) =>
    http.post<EmployeeDetail>(endpoints.employees.profileDraft(id), body),

  experience: (id: number | string) =>
    http.get<ExperienceDetail[]>(endpoints.employees.experience(id)),
  saveExperience: (id: number | string, experience: ExperienceDetailPayload[]) =>
    http.put<ExperienceDetail[]>(endpoints.employees.experience(id), { experience }),

  employeeSkills: (id: number | string) =>
    http.get<EmployeeSkill[]>(endpoints.employees.skills(id)),
  saveEmployeeSkills: (id: number | string, skills: EmployeeSkillPayload[]) =>
    http.put<EmployeeSkill[]>(endpoints.employees.skills(id), { skills }),

  assets: (id: number | string) => http.get<EmployeeAsset[]>(endpoints.employees.assets(id)),
  // Always multipart: the photo is optional, but sending one shape for both
  // cases keeps the caller from having to know which it is.
  addAsset: (id: number | string, form: FormData) =>
    http.post<EmployeeAsset>(endpoints.employees.assets(id), form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  updateAsset: (id: number | string, assetId: number | string, form: FormData) =>
    http.patch<EmployeeAsset>(endpoints.employees.asset(id, assetId), form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  removeAsset: (id: number | string, assetId: number | string) =>
    http.delete<void>(endpoints.employees.asset(id, assetId)),

  uploadPhoto: (id: number | string, file: File) => {
    const form = new FormData();
    form.append('photo', file);
    return http.post<{ photo_url: string }>(endpoints.employees.photo(id), form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  removePhoto: (id: number | string) => http.delete<void>(endpoints.employees.photo(id)),
  removeDocument: (id: number | string, documentId: number | string) =>
    http.delete<void>(endpoints.employees.document(id, documentId)),
  uploadDocument: (id: number | string, form: FormData) =>
    http.post<EmployeeDocument>(endpoints.employees.documents(id), form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),

  departments: (params?: ListParams) =>
    http.get<Paginated<Department>>(endpoints.employees.departments, { params: query(params) }),
  createDepartment: (body: Partial<Department>) =>
    http.post<Department>(endpoints.employees.departments, body),
  updateDepartment: (id: number, body: Partial<Department>) =>
    http.patch<Department>(`${endpoints.employees.departments}${id}/`, body),

  designations: (params?: ListParams) =>
    http.get<Paginated<Designation>>(endpoints.employees.designations, {
      params: query(params),
    }),
  createDesignation: (body: Partial<Designation>) =>
    http.post<Designation>(endpoints.employees.designations, body),
  updateDesignation: (id: number, body: Partial<Designation>) =>
    http.patch<Designation>(`${endpoints.employees.designations}${id}/`, body),
};

export const projectsApi = {
  list: (params?: ListParams) =>
    http.get<Paginated<Project>>(endpoints.projects.list, { params: query(params) }),
  detail: (id: number | string) => http.get<ProjectDetail>(endpoints.projects.detail(id)),
  create: (body: Record<string, unknown>) =>
    http.post<ProjectDetail>(endpoints.projects.list, body),
  update: (id: number | string, body: Record<string, unknown>) =>
    http.patch<ProjectDetail>(endpoints.projects.detail(id), body),
  cancel: (id: number | string) => http.delete<void>(endpoints.projects.detail(id)),

  members: (id: number | string) => http.get<ProjectMember[]>(endpoints.projects.members(id)),
  addMember: (id: number | string, body: Record<string, unknown>) =>
    http.post<ProjectMember>(endpoints.projects.members(id), body),
  removeMember: (id: number | string, memberId: number) =>
    http.delete<void>(`${endpoints.projects.members(id)}${memberId}/`),

  allocations: (id: number | string) =>
    http.get<ProjectAllocation[]>(endpoints.projects.allocations(id)),
  addAllocation: (id: number | string, body: Record<string, unknown>) =>
    http.post<ProjectAllocation>(endpoints.projects.allocations(id), body),
  removeAllocation: (id: number | string, allocationId: number) =>
    http.delete<void>(`${endpoints.projects.allocations(id)}${allocationId}/`),

  myAllocations: () => http.get<Paginated<ProjectAllocation>>(endpoints.projects.myAllocations),
};

export const leaveApi = {
  list: (params?: ListParams) =>
    http.get<Paginated<LeaveRequest>>(endpoints.leave.requests, { params: query(params) }),
  mine: (params?: ListParams) =>
    http.get<Paginated<LeaveRequest>>(endpoints.leave.mine, { params: query(params) }),
  detail: (id: number | string) => http.get<LeaveRequest>(endpoints.leave.detail(id)),
  apply: (body: ApplyLeavePayload) => http.post<LeaveRequest>(endpoints.leave.requests, body),
  approve: (id: number | string, comment = '') =>
    http.post<LeaveRequest>(endpoints.leave.approve(id), { comment }),
  reject: (id: number | string, comment = '') =>
    http.post<LeaveRequest>(endpoints.leave.reject(id), { comment }),
  cancel: (id: number | string, comment = '') =>
    http.post<LeaveRequest>(endpoints.leave.cancel(id), { comment }),
  hrApprovals: (params?: ListParams) =>
    http.get<Paginated<LeaveQueueRow>>(endpoints.leave.hrApprovals, {
      params: query(params),
    }),
  sendBack: (id: number | string, comment: string) =>
    http.post<LeaveRequest>(endpoints.leave.sendBack(id), { comment }),
  pendingApprovals: (params?: ListParams) =>
    http.get<Paginated<LeaveQueueRow>>(endpoints.leave.pendingApprovals, {
      params: query(params),
    }),
  teamCalendar: (params?: ListParams) =>
    http.get<LeaveRequest[]>(endpoints.leave.teamCalendar, { params: query(params) }),

  myBalances: (year?: number) =>
    http.get<LeaveBalance[]>(endpoints.leave.myBalances, { params: query({ year }) }),
  balances: (params?: ListParams) =>
    http.get<Paginated<LeaveBalance>>(endpoints.leave.balances, { params: query(params) }),

  types: (params?: ListParams) =>
    http.get<Paginated<LeaveType>>(endpoints.leave.types, { params: query(params) }),
  createType: (body: Partial<LeaveType>) => http.post<LeaveType>(endpoints.leave.types, body),
  updateType: (id: number, body: Partial<LeaveType>) =>
    http.patch<LeaveType>(`${endpoints.leave.types}${id}/`, body),

  holidays: (year?: number) =>
    http.get<Paginated<Holiday>>(endpoints.leave.holidays, { params: query({ year }) }),
  createHoliday: (body: Partial<Holiday>) => http.post<Holiday>(endpoints.leave.holidays, body),
  updateHoliday: (id: number, body: Partial<Holiday>) =>
    http.patch<Holiday>(`${endpoints.leave.holidays}${id}/`, body),
  deleteHoliday: (id: number) => http.delete<void>(`${endpoints.leave.holidays}${id}/`),
  importHolidaysDocx: (file: File, year: number) => {
    const form = new FormData();
    form.append('file', file);
    form.append('year', String(year));
    return http.post<HolidayImportSummary>(`${endpoints.leave.holidays}import-docx/`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

export const timesheetsApi = {
  list: (params?: ListParams) =>
    http.get<Paginated<TimesheetListItem>>(endpoints.timesheets.list, {
      params: query(params),
    }),
  mine: (params?: ListParams) =>
    http.get<Paginated<TimesheetListItem>>(endpoints.timesheets.mine, {
      params: query(params),
    }),
  detail: (id: number | string) => http.get<Timesheet>(endpoints.timesheets.detail(id)),
  weekly: (isoDate?: string) =>
    http.get<Timesheet>(endpoints.timesheets.weekly, { params: query({ date: isoDate }) }),
  saveEntries: (id: number | string, entries: TimesheetEntryPayload[]) =>
    http.put<Timesheet>(endpoints.timesheets.entries(id), { entries }),
  submit: (id: number | string, comment = '') =>
    http.post<Timesheet>(endpoints.timesheets.submit(id), { comment }),
  approve: (id: number | string, comment = '') =>
    http.post<Timesheet>(endpoints.timesheets.approve(id), { comment }),
  reject: (id: number | string, comment: string) =>
    http.post<Timesheet>(endpoints.timesheets.reject(id), { comment }),
  pendingApprovals: (params?: ListParams) =>
    http.get<Paginated<TimesheetListItem>>(endpoints.timesheets.pendingApprovals, {
      params: query(params),
    }),
  currentWeekSummary: () => http.get<WeekSummary>(endpoints.timesheets.currentWeekSummary),

  // HR submission tracking. `week` is any date inside the wanted week; omitted,
  // the backend answers for the last completed week.
  statusByProject: (week?: string) =>
    http.get<ProjectSubmissionResponse>(endpoints.timesheets.statusByProject, {
      params: query({ week }),
    }),
  /** Totals only — for the tab badge, which wants a number not a board. */
  submissionCounts: (week?: string) =>
    http.get<Omit<EmployeeSubmissionResponse, 'results'>>(
      endpoints.timesheets.statusByEmployee,
      { params: query({ week, counts_only: 'true' }) },
    ),
  statusByEmployee: (week?: string) =>
    http.get<EmployeeSubmissionResponse>(endpoints.timesheets.statusByEmployee, {
      params: query({ week }),
    }),
  notify: (body: { employee_ids?: number[]; project?: number; week?: string }) =>
    http.post<NotifyResult>(endpoints.timesheets.notify, body),
};

export const payrollApi = {
  structures: (params?: ListParams) =>
    http.get<Paginated<SalaryStructure>>(endpoints.payroll.salaryStructures, {
      params: query(params),
    }),
  createStructure: (body: Record<string, unknown>) =>
    http.post<SalaryStructure>(endpoints.payroll.salaryStructures, body),
  updateStructure: (id: number, body: Record<string, unknown>) =>
    http.patch<SalaryStructure>(endpoints.payroll.salaryStructure(id), body),

  runs: (params?: ListParams) =>
    http.get<Paginated<PayrollRun>>(endpoints.payroll.runs, { params: query(params) }),
  run: (id: number | string) => http.get<PayrollRunDetail>(endpoints.payroll.run(id)),
  createRun: (year: number, month: number) =>
    http.post<PayrollRun>(endpoints.payroll.runs, { year, month }),
  deleteRun: (id: number) => http.delete<void>(endpoints.payroll.run(id)),

  process: (id: number) => http.post<PayrollRun>(endpoints.payroll.process(id), {}),
  approve: (id: number) => http.post<PayrollRun>(endpoints.payroll.approve(id), {}),
  reject: (id: number, comment: string) =>
    http.post<PayrollRun>(endpoints.payroll.reject(id), { comment }),
  markPaid: (id: number) => http.post<PayrollRun>(endpoints.payroll.markPaid(id), {}),
  exportRun: (id: number) =>
    http.get<Blob>(endpoints.payroll.exportRun(id), { responseType: 'blob' }),

  myPayslips: () => http.get<Payslip[]>(endpoints.payroll.myPayslips),
  payslip: (id: number | string) => http.get<Payslip>(`${endpoints.payroll.payslips}${id}/`),

  /** Which months have a payslip, grouped by year - the drill-down's index. */
  payslipPeriods: (employeeId?: number) =>
    http.get<PayslipPeriods>(endpoints.payroll.payslipPeriods, {
      params: query({ employee: employeeId }),
    }),
  payslipPdf: (id: number) =>
    http.get<Blob>(endpoints.payroll.payslipPdf(id), { responseType: 'blob' }),
  /** HR sends one payslip to Finance for release. */
  pushToFinance: (id: number) => http.post<Payslip>(endpoints.payroll.pushToFinance(id), {}),
  payslips: (params?: ListParams) =>
    http.get<Paginated<Payslip>>(endpoints.payroll.payslips, { params: query(params) }),
};

export const notificationsApi = {
  list: (params?: ListParams) =>
    http.get<Paginated<AppNotification>>(endpoints.notifications.list, {
      params: query(params),
    }),
  markRead: (id: number) =>
    http.post<AppNotification>(endpoints.notifications.markRead(id), {}),
  markAllRead: () =>
    http.post<{ marked_read: number }>(endpoints.notifications.markAllRead, {}),
  unreadCount: () => http.get<{ unread: number }>(endpoints.notifications.unreadCount),
};

export const reportsApi = {
  dashboard: () => http.get<DashboardSummary>(endpoints.reports.dashboard),
  birthdays: () =>
    http.get<{ count: number; results: UpcomingBirthday[] }>(endpoints.reports.birthdays),
  employees: (params?: ListParams) =>
    http.get<ReportResponse>(endpoints.reports.employees, { params: query(params) }),
  leave: (params?: ListParams) =>
    http.get<ReportResponse>(endpoints.reports.leave, { params: query(params) }),
  timesheet: (params?: ListParams) =>
    http.get<ReportResponse>(endpoints.reports.timesheet, { params: query(params) }),
  projects: (params?: ListParams) =>
    http.get<ReportResponse>(endpoints.reports.projects, { params: query(params) }),

  /**
   * CSV export. `export=csv`, not `format=csv` - DRF reserves `format` for
   * content negotiation and would 404 on an unknown value.
   */
  exportCsv: (kind: 'employees' | 'leave' | 'timesheet' | 'projects', params?: ListParams) =>
    http.get<Blob>(endpoints.reports[kind], {
      params: { ...query(params), export: 'csv' },
      responseType: 'blob',
    }),
};

export const adminApi = {
  deletionRequests: (params?: ListParams) =>
    http.get<Paginated<AccountDeletionRequest>>(endpoints.administration.deletionRequests, {
      params: query(params),
    }),
  approveDeletion: (id: number, note: string) =>
    http.post<AccountDeletionRequest>(endpoints.administration.approveDeletion(id), { note }),
  rejectDeletion: (id: number, note: string) =>
    http.post<AccountDeletionRequest>(endpoints.administration.rejectDeletion(id), { note }),

  users: (params?: ListParams) =>
    http.get<Paginated<AdminUser>>(endpoints.administration.users, { params: query(params) }),
  createUser: (body: {
    email: string;
    temporary_password: string;
    first_name?: string;
    last_name?: string;
  }) => http.post<AdminUser>(endpoints.administration.users, body),
  updateUser: (id: number, body: Partial<AdminUser>) =>
    http.patch<AdminUser>(endpoints.administration.userDetail(id), body),
  setRoles: (id: number, roles: string[]) =>
    http.post<AdminUser>(`${endpoints.administration.userDetail(id)}roles/`, { roles }),
  deleteUsers: (body: { ids?: number[]; all?: boolean }) =>
    http.post<{ deleted: number; skipped: string[] }>(
      endpoints.administration.deleteUsers,
      body,
    ),
  resetPassword: (id: number, temporaryPassword: string) =>
    http.post<void>(`${endpoints.administration.userDetail(id)}reset-password/`, {
      temporary_password: temporaryPassword,
    }),

  roles: () => http.get<Paginated<Role>>(endpoints.administration.roles),
  permissions: (params?: ListParams) =>
    http.get<Paginated<{ id: number; code: string; module: string; name: string }>>(
      endpoints.administration.permissions,
      { params: query(params) },
    ),

  settings: () => http.get<Paginated<SystemSetting>>(endpoints.administration.settings),
  updateSetting: (id: number, value: string) =>
    http.patch<SystemSetting>(`${endpoints.administration.settings}${id}/`, { value }),

  auditLogs: (params?: ListParams) =>
    http.get<Paginated<AuditLogEntry>>(endpoints.administration.auditLogs, {
      params: query(params),
    }),
};

/** Turns a CSV blob into a browser download. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** The controlled skill vocabulary (decision D10), shared by the filters and the profile editor. */
export const skillsApi = {
  list: (params?: { q?: string; category?: string; page_size?: number }) =>
    http.get<Paginated<Skill>>(endpoints.employees.skillVocabulary, { params: query(params) }),
  create: (body: { name: string; category?: string }) =>
    http.post<Skill>(endpoints.employees.skillVocabulary, body),
  retire: (id: number) => http.delete<void>(`${endpoints.employees.skillVocabulary}${id}/`),
};

/**
 * Finance: releasing payslips for payment.
 *
 * Payroll works out what people are paid; Finance decides when it goes out.
 * Separate module, separate role, separate table - see apps/finance.
 */
export const financeApi = {
  approvals: (params?: ListParams) =>
    http.get<Paginated<PayslipApproval>>(endpoints.finance.approvals, {
      params: query(params),
    }),
  approval: (id: number) => http.get<PayslipApproval>(endpoints.finance.approval(id)),
  release: (id: number, comment = '') =>
    http.post<PayslipApproval>(endpoints.finance.release(id), { comment }),
  query: (id: number, comment: string) =>
    http.post<PayslipApproval>(endpoints.finance.query(id), { comment }),
};
