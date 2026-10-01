/**
 * The employee's own payslips, picked by year and then month.
 *
 * The year is this year or last year - the two anyone asks about for a loan,
 * a visa or a tax return. `/payslips/periods/` returns just the index — year,
 * month, net — so opening the page costs one small request whatever the
 * history, and the full breakdown is fetched only for the month actually being
 * looked at.
 */

import DownloadIcon from '@mui/icons-material/Download';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useState } from 'react';

import { EmptyState, ErrorAlert } from '@/components/common/Feedback';
import PayslipBreakdown from '@/features/payroll/PayslipBreakdown';
import { useApiResource } from '@/hooks/useApiResource';
import { usePayslipDownload } from '@/features/payroll/usePayslipDownload';
import { payrollApi } from '@/services/api/services';
import { money } from '@/utils/format';
import type { Payslip, PayslipPeriodMonth, PayslipPeriodYear } from '@/types/domain';

const TODAY = new Date();
const THIS_YEAR = TODAY.getFullYear();
const THIS_MONTH = TODAY.getMonth() + 1;
/** This year first: it is the one people usually want. */
const YEARS = [THIS_YEAR, THIS_YEAR - 1];

const MONTH_NAMES = Array.from({ length: 12 }, (_, index) =>
  new Date(2000, index, 1).toLocaleString('en-GB', { month: 'long' }),
);

/** The latest month of a year that has a payslip, or null. */
function newestMonth(entry: PayslipPeriodYear | undefined): number | null {
  if (!entry || entry.months.length === 0) return null;
  return Math.max(...entry.months.map((month) => month.month));
}

export default function MyPayslipsTab() {
  const periods = useApiResource(
    useCallback(() => payrollApi.payslipPeriods(), []),
    [],
  );

  const [year, setYear] = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  const { download, busy } = usePayslipDownload();

  const years = periods.data?.years ?? [];
  const byYear = (value: number) => years.find((entry) => entry.year === value);

  // Land on the newest payslip as soon as the index arrives, so the common
  // case - "what did I get paid last month?" - takes no clicks at all.
  useEffect(() => {
    if (!periods.data || year !== null) return;
    const found = periods.data.years;
    const start =
      YEARS.find((option) =>
        found.some((entry) => entry.year === option && entry.months.length),
      ) ?? THIS_YEAR;
    setYear(start);
    setMonth(newestMonth(found.find((entry) => entry.year === start)));
  }, [periods.data, year]);

  const selectedYear = year ?? THIS_YEAR;
  const activeYear = byYear(selectedYear);
  const selectedMonth: PayslipPeriodMonth | undefined = activeYear?.months.find(
    (entry) => entry.month === month,
  );
  const payslipId = selectedMonth?.payslip_id ?? null;

  const detail = useApiResource(
    useCallback(
      () =>
        payslipId ? payrollApi.payslip(payslipId) : Promise.resolve(null as Payslip | null),
      [payslipId],
    ),
    [payslipId],
  );

  if (periods.loading) return <LinearProgress />;
  if (periods.error) return <ErrorAlert error={periods.error} onRetry={periods.reload} />;

  // The current year stops at the current month - a month that has not
  // happened yet has nothing to choose.
  const monthOptions = Array.from(
    { length: selectedYear === THIS_YEAR ? THIS_MONTH : 12 },
    (_, index) => index + 1,
  );
  const paidMonths = new Set((activeYear?.months ?? []).map((entry) => entry.month));

  return (
    <Box sx={{ p: 2 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        alignItems={{ sm: 'center' }}
        sx={{ mb: 1 }}
      >
        <TextField
          select
          size="small"
          label="Year"
          value={selectedYear}
          onChange={(event) => {
            const next = Number(event.target.value);
            setYear(next);
            setMonth(newestMonth(byYear(next)));
          }}
          sx={{ minWidth: 160 }}
        >
          {YEARS.map((option) => (
            <MenuItem key={option} value={option}>
              {option}
              {option === THIS_YEAR ? ' (this year)' : ' (last year)'}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          size="small"
          label="Month"
          value={month ?? ''}
          onChange={(event) => setMonth(Number(event.target.value))}
          disabled={paidMonths.size === 0}
          sx={{ minWidth: 200 }}
        >
          {monthOptions.map((option) => (
            <MenuItem key={option} value={option} disabled={!paidMonths.has(option)}>
              {MONTH_NAMES[option - 1]}
              {!paidMonths.has(option) && (
                <Typography component="span" variant="caption" sx={{ ml: 1 }}>
                  · no payslip
                </Typography>
              )}
            </MenuItem>
          ))}
        </TextField>

        {activeYear && activeYear.months.length > 0 && (
          <Typography variant="body2" color="text.secondary">
            {activeYear.months.length} payslip{activeYear.months.length === 1 ? '' : 's'} in{' '}
            {activeYear.year} · {money(activeYear.total_net)} net in total
          </Typography>
        )}
      </Stack>

      <Divider sx={{ my: 2 }} />

      {paidMonths.size === 0 ? (
        <EmptyState
          title={`No payslips for ${selectedYear}`}
          detail="Payslips appear here once payroll for the month has been approved."
        />
      ) : (
        <>
          {detail.loading && <LinearProgress />}
          {detail.error && <ErrorAlert error={detail.error} onRetry={detail.reload} />}

          {detail.data && (
            <>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                justifyContent="space-between"
                alignItems={{ sm: 'center' }}
                spacing={1}
                sx={{ mb: 2 }}
              >
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="h4">{detail.data.period_label}</Typography>
                  <Chip
                    size="small"
                    variant="outlined"
                    color={detail.data.run_status === 'paid' ? 'success' : 'default'}
                    label={detail.data.run_status === 'paid' ? 'Paid' : 'Approved'}
                  />
                </Stack>
                <Button
                  variant="contained"
                  startIcon={<DownloadIcon />}
                  onClick={() =>
                    void download(detail.data!.id, selectedMonth?.month_name ?? 'payslip')
                  }
                  disabled={busy}
                >
                  {busy ? 'Preparing...' : 'Download PDF'}
                </Button>
              </Stack>

              <PayslipBreakdown slip={detail.data} />
            </>
          )}
        </>
      )}
    </Box>
  );
}
