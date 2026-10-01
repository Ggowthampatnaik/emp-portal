/**
 * One payslip, itemised.
 *
 * Extracted from the employee's own payslip tab once Finance needed to show
 * exactly the same thing while deciding whether to release it — the two views
 * disagreeing about someone's pay would be worse than either being wrong.
 */

import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { money } from '@/utils/format';
import type { Payslip } from '@/types/domain';

function Line({ label, amount, bold }: { label: string; amount: string; bold?: boolean }) {
  return (
    <Stack direction="row" justifyContent="space-between" sx={{ py: 0.5 }}>
      <Typography variant="body2" fontWeight={bold ? 700 : 400}>
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={bold ? 700 : 400}>
        {money(amount)}
      </Typography>
    </Stack>
  );
}

export default function PayslipBreakdown({ slip }: { slip: Payslip }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 3,
        gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
      }}
    >
      <Box>
        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
          Earnings
        </Typography>
        <Divider />
        <Line label="Basic" amount={slip.basic} />
        <Line label="House rent allowance" amount={slip.hra} />
        <Line label="Conveyance" amount={slip.conveyance_allowance} />
        <Line label="Medical" amount={slip.medical_allowance} />
        <Line label="Special allowance" amount={slip.special_allowance} />
        <Divider />
        <Line label="Gross earnings" amount={slip.gross_earnings} bold />
      </Box>

      <Box>
        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
          Deductions
        </Typography>
        <Divider />
        <Line label="Provident fund" amount={slip.provident_fund} />
        <Line label="Professional tax" amount={slip.professional_tax} />
        <Line label="Income tax (TDS)" amount={slip.income_tax} />
        {Number(slip.other_deductions) > 0 && (
          <Line label="Other" amount={slip.other_deductions} />
        )}
        <Divider />
        <Line label="Total deductions" amount={slip.total_deductions} bold />
      </Box>

      <Box sx={{ gridColumn: '1 / -1' }}>
        <Divider sx={{ mb: 1 }} />
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ sm: 'center' }}
          spacing={1}
        >
          <Stack direction="row" spacing={2}>
            <Typography variant="caption" color="text.secondary">
              Working days: <strong>{slip.working_days}</strong>
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Paid days: <strong>{slip.paid_days}</strong>
            </Typography>
            {Number(slip.lop_days) > 0 && (
              <Typography variant="caption" color="warning.main">
                Unpaid leave: <strong>{slip.lop_days}</strong> ({money(slip.lop_amount)})
              </Typography>
            )}
          </Stack>
          <Typography variant="h3" component="p" color="primary.main">
            {money(slip.net_pay)}
          </Typography>
        </Stack>
      </Box>
    </Box>
  );
}
