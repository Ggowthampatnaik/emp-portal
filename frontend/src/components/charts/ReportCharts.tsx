/**
 * One chart per report tab, each summarising the table beneath it.
 *
 * The table stays the record - it is complete, sortable by eye and exportable.
 * The chart answers the question the table makes you compute: which department
 * is largest, where the leave is going, which project is absorbing the hours.
 * Every one of these aggregates the rows the page already fetched, so no chart
 * costs an extra request.
 */

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import ChartFrame from '@/components/charts/ChartFrame';
import { useChartTheme } from '@/hooks/useChartTheme';
import { CHART_SERIES, CHART_STATUS } from '@/styles/theme';
import type { ReportRow } from '@/types/domain';

/** Report values arrive as strings for decimals; everything here is numeric. */
function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Sums `valueKey` per distinct `labelKey`, largest first. */
function totalBy(rows: ReportRow[], labelKey: string, valueKey: string) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const label = String(row[labelKey] ?? '—');
    totals.set(label, (totals.get(label) ?? 0) + num(row[valueKey]));
  }
  return [...totals.entries()]
    .map(([label, value]) => ({ label, value }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value);
}

/** Long department and project names need room; this keeps the axis honest. */
function truncate(label: string, max = 18): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

function NothingToPlot() {
  return (
    <Box sx={{ px: 2, pt: 2 }}>
      <Typography variant="caption" color="text.secondary">
        Not enough data to chart yet.
      </Typography>
    </Box>
  );
}

/* -- Headcount ------------------------------------------------------------ */

export function HeadcountChart({ rows }: { rows: ReportRow[] }) {
  const chart = useChartTheme();
  const data = rows
    .map((row) => ({
      label: truncate(String(row.department ?? '—')),
      active: num(row.active),
      on_notice: num(row.on_notice),
      inactive: num(row.inactive),
    }))
    .filter((row) => row.active + row.on_notice + row.inactive > 0)
    .sort((a, b) => b.active + b.on_notice - (a.active + a.on_notice));

  if (data.length === 0) return <NothingToPlot />;

  return (
    <ChartFrame
      title="Headcount by department"
      caption="Stacked by employment status."
      height={Math.max(200, data.length * 44 + 60)}
    >
      <ResponsiveContainer>
        {/* Horizontal: department names are words, and words read better along
            the axis than rotated under it. */}
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24 }}>
          <CartesianGrid stroke={chart.grid} horizontal={false} />
          <XAxis type="number" stroke={chart.axis} fontSize={12} allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="label"
            stroke={chart.axis}
            fontSize={12}
            width={130}
            tickLine={false}
          />
          <Tooltip contentStyle={chart.tooltip} cursor={chart.cursor} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar
            dataKey="active"
            name="Active"
            stackId="s"
            fill={CHART_SERIES[0]}
            radius={[0, 0, 0, 0]}
          />
          <Bar dataKey="on_notice" name="On notice" stackId="s" fill={CHART_STATUS.pending} />
          <Bar
            dataKey="inactive"
            name="Inactive"
            stackId="s"
            fill={CHART_SERIES[6]}
            radius={[0, 4, 4, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/* -- Leave ---------------------------------------------------------------- */

export function LeaveChart({ rows }: { rows: ReportRow[] }) {
  const chart = useChartTheme();
  const byType = totalBy(rows, 'leave_type', 'approved_days');

  const approved = rows.reduce((sum, row) => sum + num(row.approved_days), 0);
  const pending = rows.reduce((sum, row) => sum + num(row.pending_days), 0);

  if (byType.length === 0 && pending === 0) return <NothingToPlot />;

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
      }}
    >
      <ChartFrame title="Approved days by leave type" caption="Across the selected period.">
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={byType}
              dataKey="value"
              nameKey="label"
              innerRadius="52%"
              outerRadius="80%"
              paddingAngle={2}
            >
              {byType.map((entry, index) => (
                <Cell key={entry.label} fill={CHART_SERIES[index % CHART_SERIES.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={chart.tooltip} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
      </ChartFrame>

      <ChartFrame title="Approved against pending" caption="Days, company-wide for your scope.">
        <ResponsiveContainer>
          {/* One category, so the bars would otherwise stretch to half the
              panel each; capping the width keeps them reading as bars. */}
          <BarChart
            data={[{ label: 'Days', approved, pending }]}
            margin={{ left: 8, right: 16 }}
            barGap={12}
            maxBarSize={72}
          >
            <CartesianGrid stroke={chart.grid} vertical={false} />
            <XAxis dataKey="label" stroke={chart.axis} fontSize={12} />
            <YAxis stroke={chart.axis} fontSize={12} />
            <Tooltip contentStyle={chart.tooltip} cursor={chart.cursor} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar
              dataKey="approved"
              name="Approved"
              fill={CHART_STATUS.approved}
              radius={[4, 4, 0, 0]}
            />
            <Bar
              dataKey="pending"
              name="Pending"
              fill={CHART_STATUS.pending}
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>
    </Box>
  );
}

/* -- Timesheet hours ------------------------------------------------------ */

export function TimesheetChart({ rows }: { rows: ReportRow[] }) {
  const chart = useChartTheme();
  // Top projects only: a company-wide report can carry dozens, and a bar chart
  // with forty categories is a texture, not a chart.
  const data = totalBy(rows, 'project', 'hours')
    .slice(0, 10)
    .map((entry) => ({ ...entry, label: truncate(entry.label) }));

  if (data.length === 0) return <NothingToPlot />;

  return (
    <ChartFrame
      title="Hours booked by project"
      caption={data.length === 10 ? 'Top 10 projects by hours.' : 'Across the selected period.'}
      height={Math.max(200, data.length * 34 + 60)}
    >
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24 }}>
          <CartesianGrid stroke={chart.grid} horizontal={false} />
          <XAxis type="number" stroke={chart.axis} fontSize={12} />
          <YAxis
            type="category"
            dataKey="label"
            stroke={chart.axis}
            fontSize={12}
            width={130}
            tickLine={false}
          />
          <Tooltip contentStyle={chart.tooltip} cursor={chart.cursor} />
          <Bar dataKey="value" name="Hours" radius={[0, 4, 4, 0]}>
            {data.map((entry, index) => (
              <Cell key={entry.label} fill={CHART_SERIES[index % CHART_SERIES.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/* -- Projects ------------------------------------------------------------- */

export function ProjectsChart({ rows }: { rows: ReportRow[] }) {
  const chart = useChartTheme();
  const data = rows
    .map((row) => ({
      label: truncate(String(row.name ?? row.code ?? '—')),
      hours: num(row.hours_booked),
      team: num(row.team_size),
    }))
    .filter((row) => row.hours > 0 || row.team > 0)
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 10);

  if (data.length === 0) return <NothingToPlot />;

  return (
    <ChartFrame
      title="Hours booked by project"
      caption="Ten busiest projects, with team size alongside."
      height={Math.max(200, data.length * 40 + 60)}
    >
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24 }}>
          <CartesianGrid stroke={chart.grid} horizontal={false} />
          <XAxis type="number" stroke={chart.axis} fontSize={12} />
          <YAxis
            type="category"
            dataKey="label"
            stroke={chart.axis}
            fontSize={12}
            width={130}
            tickLine={false}
          />
          <Tooltip contentStyle={chart.tooltip} cursor={chart.cursor} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar
            dataKey="hours"
            name="Hours booked"
            fill={CHART_SERIES[0]}
            radius={[0, 4, 4, 0]}
          />
          <Bar dataKey="team" name="Team size" fill={CHART_SERIES[1]} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
