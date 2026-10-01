/**
 * One row of a report, on its own page.
 *
 * A report table answers "what are the numbers"; the question it leaves is "is
 * this row big or small", and a cell on its own cannot say. This page answers
 * it in pictures: where the row sits among its peers, what its own numbers are
 * made of, and how much of each column total it accounts for.
 *
 * A page rather than a dialog, so it has an address: the row is identified by
 * its own values (report rows are aggregates and carry no id), which means a
 * link survives a refresh and can be sent to somebody. The report behind it is
 * fetched again with the same date range, so the figures here and the table
 * they were opened from are the same figures.
 */

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Divider from '@mui/material/Divider';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useCallback } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
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
import { EmptyState, ErrorAlert } from '@/components/common/Feedback';
import PageHeader from '@/components/common/PageHeader';
import { useApiResource } from '@/hooks/useApiResource';
import { useChartTheme } from '@/hooks/useChartTheme';
import { usePermissions } from '@/hooks/usePermissions';
import { reportsApi } from '@/services/api/services';
import { CHART_SERIES } from '@/styles/theme';
import type { ReportResponse } from '@/types/domain';
import { formatDate } from '@/utils/date';

import { ordinal, percent, toNumber } from './reportMath';
import { REPORTS, rowKey } from './reportSpecs';

/** Long names need room; this keeps an axis readable. */
function truncate(label: string, max = 22): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

/** The headline figure of one measure, with its place in the report. */
function MeasureTile({
  label,
  display,
  share,
  rank,
  of,
}: {
  label: string;
  display: string;
  share: string | null;
  rank: number;
  of: number;
}) {
  return (
    <Card sx={{ p: 2 }}>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <Typography variant="h3" component="p" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {display}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {share ? `${share} of the report · ${ordinal(rank)} of ${of} rows` : 'Nothing recorded'}
      </Typography>
    </Card>
  );
}

/** A label above its value, the same shape the profile panels use. */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <Typography variant="body2">{value || '—'}</Typography>
    </Box>
  );
}

export default function ReportRowPage() {
  const { kind, rowKey: address = '' } = useParams();
  const [params] = useSearchParams();
  const { canAny } = usePermissions();
  const chart = useChartTheme();

  const spec = REPORTS.find((report) => report.kind === kind);
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  // Checked before the request, not only before the render: asking for a
  // report you may not see earns a 403 and an error banner in place of the
  // explanation below.
  const allowed = spec !== undefined && canAny(spec.permission);

  const fetcher = useCallback((): Promise<ReportResponse | null> => {
    if (!spec || !allowed) return Promise.resolve(null);
    return reportsApi[spec.kind](
      spec.dated ? { from: from || undefined, to: to || undefined } : undefined,
    );
  }, [spec, allowed, from, to]);

  const { data, loading, error, reload } = useApiResource(fetcher, [kind, allowed, from, to]);

  // Back to the table this was opened from, on the right tab and with the same
  // range still in the date boxes.
  const back = `/reports?${new URLSearchParams({
    ...(kind ? { tab: kind } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  })}`;

  if (!spec) {
    return (
      <>
        <PageHeader title="Report" />
        <EmptyState
          title="No such report"
          detail="The address names a report that does not exist."
        />
      </>
    );
  }

  if (!allowed) {
    return (
      <>
        <PageHeader title={spec.label} />
        <EmptyState
          title="This report is not available to your role"
          detail="Reporting permissions are granted to managers, HR and administrators."
        />
      </>
    );
  }

  const rows = data?.results ?? [];
  const row = rows.find((candidate) => rowKey(spec, candidate) === address);

  const backButton = (
    <Button component={Link} to={back} startIcon={<ArrowBackIcon />}>
      Back to {spec.label}
    </Button>
  );

  if (loading) {
    return (
      <>
        <PageHeader title={spec.label} actions={backButton} />
        <LinearProgress />
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageHeader title={spec.label} actions={backButton} />
        <ErrorAlert error={error} onRetry={reload} />
      </>
    );
  }

  if (!row) {
    return (
      <>
        <PageHeader title={spec.label} actions={backButton} />
        <EmptyState
          title="That row is no longer in this report"
          detail={
            spec.dated
              ? 'The date range may have moved on since the link was made.'
              : 'It may have been renamed or removed since the link was made.'
          }
        />
      </>
    );
  }

  const measures = spec.columns.filter((column) => column.align === 'right');
  const attributes = spec.columns.filter((column) => column.align !== 'right');
  const shown = new Set(spec.columns.map((column) => column.key));
  const extras = Object.keys(row).filter((key) => !shown.has(key));

  const totals = new Map(
    measures.map((column) => [
      column.key,
      rows.reduce((sum, other) => sum + toNumber(other[column.key]), 0),
    ]),
  );
  const rankOf = (key: string) =>
    rows.filter((other) => toNumber(other[key]) > toNumber(row[key])).length + 1;

  // Where this row sits among its peers, on the measure the report is about.
  // Ten neighbours at most: a chart of forty bars is a texture, not a chart -
  // but the row being looked at is always drawn, however far down it ranks.
  const ranked = [...rows].sort(
    (a, b) => toNumber(b[spec.rank.key]) - toNumber(a[spec.rank.key]),
  );
  const top = ranked.slice(0, 10);
  if (!top.includes(row)) top.push(row);
  const comparison = top.map((entry) => ({
    label: truncate(spec.shortLabel(entry)),
    value: toNumber(entry[spec.rank.key]),
    isThisRow: entry === row,
  }));

  // Each measure as a percentage of its column total, so measures in different
  // units can share one axis.
  const shares = measures
    .map((column) => ({
      label: column.label,
      value:
        Math.round(
          ((toNumber(row[column.key]) / (totals.get(column.key) || 1)) * 100 + Number.EPSILON) *
            10,
        ) / 10,
    }))
    .filter((entry) => entry.value > 0);

  const composition = (spec.composition?.(row) ?? []).filter((slice) => slice.value > 0);
  const insights = spec.insights(row);

  const range =
    spec.dated && (from || to)
      ? `${from ? formatDate(from) : 'the beginning'} to ${to ? formatDate(to) : 'today'}`
      : null;

  return (
    <>
      <PageHeader
        title={spec.heading(row)}
        subtitle={`${spec.subheading(row)}${range ? ` · ${range}` : ''}`}
        actions={backButton}
      />

      <Box
        sx={{
          display: 'grid',
          gap: 2,
          // As many columns as there are measures, up to four: two tiles
          // stretched across a quarter of the width each would leave half the
          // row empty for no reason.
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(2, 1fr)',
            md: `repeat(${Math.min(measures.length, 4)}, 1fr)`,
          },
          mb: 2,
        }}
      >
        {measures.map((column) => {
          const total = totals.get(column.key) ?? 0;
          return (
            <MeasureTile
              key={column.key}
              label={column.label}
              display={String(row[column.key] ?? '0')}
              share={total > 0 ? percent(toNumber(row[column.key]), total) : null}
              rank={rankOf(column.key)}
              of={rows.length}
            />
          );
        })}
      </Box>

      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', md: composition.length > 0 ? '3fr 2fr' : '1fr' },
          mb: 2,
        }}
      >
        <Card>
          <ChartFrame
            title={`${spec.rank.label} against the rest of the report`}
            caption={
              ranked.length > top.length
                ? `The ten largest, and this row. ${spec.heading(row)} is picked out.`
                : `Every row in the report. ${spec.heading(row)} is picked out.`
            }
            height={Math.max(220, comparison.length * 34 + 60)}
          >
            <ResponsiveContainer>
              {/* Horizontal: these labels are names, and names read better
                  along the axis than rotated beneath it. */}
              <BarChart data={comparison} layout="vertical" margin={{ left: 8, right: 24 }}>
                <CartesianGrid stroke={chart.grid} horizontal={false} />
                <XAxis type="number" stroke={chart.axis} fontSize={12} />
                <YAxis
                  type="category"
                  dataKey="label"
                  stroke={chart.axis}
                  fontSize={12}
                  // Wide enough for a truncated name on one line: recharts
                  // word-wraps a tick that overflows, and a two-line tick
                  // beside a one-line tick reads as two different things.
                  width={195}
                  tickLine={false}
                />
                <Tooltip contentStyle={chart.tooltip} cursor={chart.cursor} />
                <Bar dataKey="value" name={spec.rank.label} radius={[0, 4, 4, 0]}>
                  {comparison.map((entry, index) => (
                    <Cell
                      key={`${entry.label}-${index}`}
                      // Everything else is one muted colour, so the eye lands
                      // on the row the page is about rather than reading a
                      // palette for meaning that is not there.
                      fill={entry.isThisRow ? CHART_SERIES[0] : chart.grid}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>
        </Card>

        {composition.length > 0 && (
          <Card>
            <ChartFrame title="What this row is made of" caption="This row's own numbers.">
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={composition}
                    dataKey="value"
                    nameKey="label"
                    innerRadius="52%"
                    outerRadius="80%"
                    // A single slice is the whole ring; a gap between it and
                    // itself reads as a missing piece.
                    paddingAngle={composition.length > 1 ? 2 : 0}
                  >
                    {composition.map((slice) => (
                      <Cell key={slice.label} fill={slice.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={chart.tooltip} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </ChartFrame>
          </Card>
        )}
      </Box>

      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', md: '3fr 2fr' },
        }}
      >
        <Card>
          {shares.length > 0 ? (
            <ChartFrame
              title="Share of each column total"
              caption="Percent of the whole report, so measures in different units can be read together."
              height={Math.max(200, shares.length * 40 + 60)}
            >
              <ResponsiveContainer>
                <BarChart data={shares} layout="vertical" margin={{ left: 8, right: 24 }}>
                  <CartesianGrid stroke={chart.grid} horizontal={false} />
                  <XAxis
                    type="number"
                    domain={[0, 100]}
                    unit="%"
                    stroke={chart.axis}
                    fontSize={12}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    stroke={chart.axis}
                    fontSize={12}
                    width={110}
                    tickLine={false}
                  />
                  <Tooltip contentStyle={chart.tooltip} cursor={chart.cursor} />
                  <Bar dataKey="value" name="Share" unit="%" radius={[0, 4, 4, 0]}>
                    {shares.map((entry, index) => (
                      <Cell
                        key={entry.label}
                        fill={CHART_SERIES[index % CHART_SERIES.length]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartFrame>
          ) : (
            <Box sx={{ p: 2 }}>
              <Typography variant="subtitle2">Share of each column total</Typography>
              <Typography variant="caption" color="text.secondary">
                Every measure on this row is zero, so there is nothing to plot.
              </Typography>
            </Box>
          )}
        </Card>

        <Card sx={{ p: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            What that adds up to
          </Typography>
          <Stack divider={<Divider flexItem />}>
            {insights.map((insight) => (
              <Stack
                key={insight.label}
                direction="row"
                justifyContent="space-between"
                alignItems="baseline"
                spacing={2}
                sx={{ py: 0.75 }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2">{insight.label}</Typography>
                  {insight.note && (
                    <Typography variant="caption" color="text.secondary" display="block">
                      {insight.note}
                    </Typography>
                  )}
                </Box>
                <Typography
                  variant="body2"
                  fontWeight={600}
                  sx={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}
                >
                  {insight.value}
                </Typography>
              </Stack>
            ))}
          </Stack>

          <Typography variant="subtitle2" sx={{ mt: 2.5 }} gutterBottom>
            Row details
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gap: 2,
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
            }}
          >
            {attributes.map((column) => (
              <Field
                key={column.key}
                label={column.label}
                value={String(row[column.key] ?? '')}
              />
            ))}
            {/* Fields the report carries but the table has no column for -
                `managers` on the headcount report, for one. They are in the
                CSV export, so they belong on the record too. */}
            {extras.map((key) => (
              <Field
                key={key}
                label={key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ')}
                value={String(row[key] ?? '')}
              />
            ))}
          </Box>
        </Card>
      </Box>
    </>
  );
}
