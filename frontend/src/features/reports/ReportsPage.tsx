/**
 * Reports. Each tab is the same shape - filters, a chart, a table, a CSV
 * export - so one generic renderer covers all four; only the fetcher, the
 * columns and the chart differ.
 *
 * The chart summarises; the table remains the record. Both are built from the
 * same fetched rows, so adding the charts cost no extra requests. Clicking a
 * row opens it on its own page, where it is drawn against the rest of the
 * report.
 */

import DownloadIcon from '@mui/icons-material/Download';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useState, type ReactElement } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { useAppDispatch } from '@/app/hooks';
import {
  HeadcountChart,
  LeaveChart,
  ProjectsChart,
  TimesheetChart,
} from '@/components/charts/ReportCharts';
import { EmptyState, ErrorAlert } from '@/components/common/Feedback';
import PageHeader from '@/components/common/PageHeader';
import { showToast } from '@/features/ui/uiSlice';
import { usePermissions } from '@/hooks/usePermissions';
import { useApiResource } from '@/hooks/useApiResource';
import { downloadBlob, reportsApi } from '@/services/api/services';
import type { ReportResponse, ReportRow } from '@/types/domain';
import { formatDate } from '@/utils/date';

import { REPORTS, rowKey, type ReportKind, type ReportSpec } from './reportSpecs';

/** `total_headcount` → `Total headcount`, to read as copy rather than a key. */
function sentenceCase(key: string): string {
  const words = key.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Dresses ISO dates in the summary row like every other date in the portal. */
function summaryValue(value: unknown): string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? formatDate(value)
    : String(value);
}

/**
 * The chart above each table. Kept here rather than in the spec table, so that
 * describing a report stays free of JSX and the detail page can import it.
 */
const CHARTS: Record<ReportKind, (rows: ReportRow[]) => ReactElement> = {
  employees: (rows) => <HeadcountChart rows={rows} />,
  leave: (rows) => <LeaveChart rows={rows} />,
  timesheet: (rows) => <TimesheetChart rows={rows} />,
  projects: (rows) => <ProjectsChart rows={rows} />,
};

export default function ReportsPage() {
  const { canAny } = usePermissions();
  const [params] = useSearchParams();
  const available = REPORTS.filter((report) => canAny(report.permission));
  // `?tab=leave` opens the report it names, which is how the back button from
  // a row's own page returns to the table it was opened from.
  const [tab, setTab] = useState(() =>
    Math.max(
      0,
      available.findIndex((report) => report.kind === params.get('tab')),
    ),
  );

  if (available.length === 0) {
    return (
      <>
        <PageHeader title="Reports & analytics" />
        <EmptyState
          title="No reports available to your role"
          detail="Reporting permissions are granted to managers, HR and administrators."
        />
      </>
    );
  }

  const spec = available[Math.min(tab, available.length - 1)];

  return (
    <>
      <PageHeader
        title="Reports & analytics"
        subtitle="Scoped to what you may see: your branch as a manager, the organization as HR"
      />
      <Card>
        <Tabs
          value={Math.min(tab, available.length - 1)}
          onChange={(_, next) => setTab(next)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ px: 2 }}
        >
          {available.map((report) => (
            <Tab key={report.kind} label={report.label} />
          ))}
        </Tabs>
        <ReportTab key={spec.kind} spec={spec} />
      </Card>
    </>
  );
}

function ReportTab({ spec }: { spec: ReportSpec }) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [params] = useSearchParams();

  // Seeded from the address so that coming back from a row's page restores the
  // range that produced it.
  const [from, setFrom] = useState(params.get('from') ?? '');
  const [to, setTo] = useState(params.get('to') ?? '');
  const [exporting, setExporting] = useState(false);

  const fetcher = useCallback((): Promise<ReportResponse> => {
    const query = spec.dated ? { from: from || undefined, to: to || undefined } : undefined;
    return reportsApi[spec.kind](query);
  }, [spec.kind, spec.dated, from, to]);

  const { data, loading, error, reload } = useApiResource(fetcher, [spec.kind, from, to]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await reportsApi.exportCsv(
        spec.kind,
        spec.dated ? { from: from || undefined, to: to || undefined } : undefined,
      );
      downloadBlob(blob, `${spec.kind}-report.csv`);
      dispatch(showToast('Export downloaded.', 'success'));
    } catch {
      dispatch(showToast('The export could not be generated.', 'error'));
    } finally {
      setExporting(false);
    }
  };

  /** The row's own page, carrying the range that produced the row. */
  const openRow = (row: ReportRow) => {
    const query = new URLSearchParams({
      ...(spec.dated && from ? { from } : {}),
      ...(spec.dated && to ? { to } : {}),
    }).toString();
    navigate(
      `/reports/${spec.kind}/${encodeURIComponent(rowKey(spec, row))}${query ? `?${query}` : ''}`,
    );
  };

  const rows = data?.results ?? [];
  const totals = Object.entries(data ?? {}).filter(
    ([key]) => key !== 'results' && key !== 'from' && key !== 'to',
  );

  return (
    <>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        alignItems={{ md: 'center' }}
        sx={{ p: 2 }}
      >
        {spec.dated && (
          <>
            <TextField
              label="From"
              type="date"
              size="small"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              label="To"
              type="date"
              size="small"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </>
        )}
        <Stack direction="row" spacing={2} sx={{ flexGrow: 1 }}>
          {/* Summary keys arrive as snake_case and dates as ISO strings; both
              are dressed to match the rest of the portal's copy. */}
          {totals.map(([key, value]) => (
            <Typography key={key} variant="body2" color="text.secondary">
              {sentenceCase(key)}: <strong>{summaryValue(value)}</strong>
            </Typography>
          ))}
        </Stack>
        {can('report.export') && (
          <Button
            startIcon={<DownloadIcon />}
            variant="outlined"
            onClick={handleExport}
            disabled={exporting || rows.length === 0}
          >
            {exporting ? 'Exporting...' : 'Export CSV'}
          </Button>
        )}
      </Stack>

      {error && <ErrorAlert error={error} onRetry={reload} />}
      {loading ? (
        <LinearProgress />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No data for this report"
          detail={spec.dated ? 'Try widening the date range.' : undefined}
        />
      ) : (
        <>
          {CHARTS[spec.kind](rows)}
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  {spec.columns.map((column) => (
                    <TableCell key={column.key} align={column.align}>
                      {column.label}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row, index) => (
                  <TableRow
                    key={index}
                    hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() => openRow(row)}
                  >
                    {spec.columns.map((column) => (
                      <TableCell key={column.key} align={column.align}>
                        {String(row[column.key] ?? '-')}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </>
  );
}
