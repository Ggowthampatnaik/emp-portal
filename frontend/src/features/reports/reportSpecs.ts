/**
 * What each report is made of.
 *
 * The Reports page draws the table and the detail page draws one row of it, so
 * the description of a report - its columns, which of them identify a row, how
 * a row is named and what its numbers mean - lives here rather than in either
 * page. Charts stay out of this module: it holds data about the reports, not
 * JSX, so both pages can import it without dragging a component tree along.
 */

import { CHART_SERIES, CHART_STATUS } from '@/styles/theme';
import type { PermissionCode } from '@/types/auth';
import type { ReportRow } from '@/types/domain';

import { percent, toNumber } from './reportMath';

export type ReportKind = 'employees' | 'leave' | 'timesheet' | 'projects';

export interface ReportColumn {
  key: string;
  label: string;
  /** Right-aligned columns are the measures: the numbers worth comparing. */
  align?: 'right';
}

/** A line of arithmetic the table has no column for. */
export interface ReportInsight {
  label: string;
  value: string;
  note?: string;
}

/** One wedge of a row's own numbers, when they share a unit. */
export interface ReportSlice {
  label: string;
  value: number;
  color: string;
}

export interface ReportSpec {
  kind: ReportKind;
  label: string;
  permission: PermissionCode;
  dated: boolean;
  columns: ReportColumn[];
  /**
   * The columns that identify a row. Report rows carry no id - they are
   * aggregates, built fresh on every request - so this is what addresses one
   * in a URL, and what finds it again after a refresh.
   */
  identity: string[];
  heading: (row: ReportRow) => string;
  subheading: (row: ReportRow) => string;
  /** Short enough for an axis tick beside twenty others. */
  shortLabel: (row: ReportRow) => string;
  /** The measure the report is ranked by when a row is compared to its peers. */
  rank: { key: string; label: string };
  /** The row's own numbers split by kind, where they share a unit. */
  composition?: (row: ReportRow) => ReportSlice[];
  insights: (row: ReportRow) => ReportInsight[];
}

/** Addresses one row of a report: the identity columns, joined. */
export function rowKey(spec: ReportSpec, row: ReportRow): string {
  return spec.identity.map((key) => String(row[key] ?? '')).join('|');
}

export const REPORTS: ReportSpec[] = [
  {
    kind: 'employees',
    label: 'Headcount',
    permission: 'report.employee',
    dated: false,
    columns: [
      { key: 'department', label: 'Department' },
      { key: 'headcount', label: 'Headcount', align: 'right' },
      { key: 'active', label: 'Active', align: 'right' },
      { key: 'on_notice', label: 'On notice', align: 'right' },
      { key: 'inactive', label: 'Inactive', align: 'right' },
    ],
    identity: ['department'],
    heading: (row) => String(row.department),
    subheading: () => 'Department headcount',
    shortLabel: (row) => String(row.department),
    rank: { key: 'headcount', label: 'Headcount' },
    composition: (row) => [
      { label: 'Active', value: toNumber(row.active), color: CHART_SERIES[0] },
      { label: 'On notice', value: toNumber(row.on_notice), color: CHART_STATUS.pending },
      { label: 'Inactive', value: toNumber(row.inactive), color: CHART_SERIES[6] },
    ],
    insights: (row) => {
      const headcount = toNumber(row.headcount);
      return [
        {
          label: 'In post',
          value: percent(toNumber(row.active), headcount),
          note: `${row.active} active of ${headcount}`,
        },
        {
          label: 'Leaving or gone',
          value: String(toNumber(row.on_notice) + toNumber(row.inactive)),
          note: 'On notice plus inactive',
        },
      ];
    },
  },
  {
    kind: 'leave',
    label: 'Leave',
    permission: 'report.leave',
    dated: true,
    columns: [
      { key: 'employee_code', label: 'Code' },
      { key: 'employee', label: 'Employee' },
      { key: 'department', label: 'Department' },
      { key: 'leave_type', label: 'Leave type' },
      { key: 'approved_days', label: 'Approved', align: 'right' },
      { key: 'pending_days', label: 'Pending', align: 'right' },
      { key: 'rejected_requests', label: 'Rejected', align: 'right' },
    ],
    // One employee holds a row per leave type, so the code alone is not enough.
    identity: ['employee_code', 'leave_type'],
    heading: (row) => `${row.employee} — ${row.leave_type}`,
    subheading: (row) => `${row.employee_code} · ${row.department || 'No department'}`,
    shortLabel: (row) => `${row.employee} · ${row.leave_type}`,
    rank: { key: 'approved_days', label: 'Approved days' },
    composition: (row) => [
      {
        label: 'Approved',
        value: toNumber(row.approved_days),
        color: CHART_STATUS.approved,
      },
      { label: 'Pending', value: toNumber(row.pending_days), color: CHART_STATUS.pending },
    ],
    insights: (row) => {
      const approved = toNumber(row.approved_days);
      const pending = toNumber(row.pending_days);
      return [
        {
          label: 'Days committed',
          value: (approved + pending).toFixed(1),
          note: 'Approved plus still awaiting a decision',
        },
        {
          label: 'Requests rejected',
          value: String(row.rejected_requests),
          note: 'Refused, so counted in neither day total',
        },
      ];
    },
  },
  {
    kind: 'timesheet',
    label: 'Timesheet hours',
    permission: 'report.timesheet',
    dated: true,
    columns: [
      { key: 'employee_code', label: 'Code' },
      { key: 'employee', label: 'Employee' },
      { key: 'project_code', label: 'Project' },
      { key: 'project', label: 'Project name' },
      { key: 'hours', label: 'Hours', align: 'right' },
      { key: 'billable_hours', label: 'Billable', align: 'right' },
    ],
    identity: ['employee_code', 'project_code'],
    heading: (row) => `${row.employee} on ${row.project}`,
    subheading: (row) => `${row.employee_code} · ${row.project_code}`,
    shortLabel: (row) => `${row.employee} · ${row.project_code}`,
    rank: { key: 'hours', label: 'Hours booked' },
    composition: (row) => [
      { label: 'Billable', value: toNumber(row.billable_hours), color: CHART_SERIES[0] },
      {
        label: 'Not billable',
        value: toNumber(row.hours) - toNumber(row.billable_hours),
        color: CHART_SERIES[6],
      },
    ],
    insights: (row) => {
      const hours = toNumber(row.hours);
      const billable = toNumber(row.billable_hours);
      return [
        {
          label: 'Billable share',
          value: percent(billable, hours),
          note: `${row.billable_hours} of ${row.hours} hours`,
        },
        {
          label: 'Not billable',
          value: (hours - billable).toFixed(2),
          note: 'Booked to the project, not chargeable to the client',
        },
      ];
    },
  },
  {
    kind: 'projects',
    label: 'Projects',
    permission: 'report.project',
    dated: false,
    columns: [
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Project' },
      { key: 'client', label: 'Client' },
      { key: 'status', label: 'Status' },
      { key: 'team_size', label: 'Team', align: 'right' },
      { key: 'total_allocation', label: 'Allocation %', align: 'right' },
      { key: 'hours_booked', label: 'Hours booked', align: 'right' },
    ],
    identity: ['code'],
    heading: (row) => String(row.name),
    subheading: (row) => `${row.code} · ${row.client || 'No client'} · ${row.status}`,
    shortLabel: (row) => String(row.name),
    rank: { key: 'hours_booked', label: 'Hours booked' },
    // Team size, allocation and hours are three different units, so there is
    // nothing here that a single split would be honest about.
    insights: (row) => {
      const team = toNumber(row.team_size);
      const allocation = toNumber(row.total_allocation);
      const hours = toNumber(row.hours_booked);
      return [
        {
          label: 'Allocation per person',
          value: team > 0 ? `${Math.round(allocation / team)}%` : '—',
          note: `${allocation}% spread across ${team} in the team`,
        },
        {
          label: 'Hours per person',
          value: team > 0 ? (hours / team).toFixed(2) : '—',
          note: 'Hours booked divided by the current team size',
        },
      ];
    },
  },
];
