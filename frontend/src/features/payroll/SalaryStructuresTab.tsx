/** Salary structures: what each employee is paid, effective-dated. */

import AddIcon from '@mui/icons-material/Add';
import Box from '@mui/material/Box';
import SearchIcon from '@mui/icons-material/Search';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import Divider from '@mui/material/Divider';
import LinearProgress from '@mui/material/LinearProgress';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useAppDispatch } from '@/app/hooks';
import { EmptyState, ErrorAlert } from '@/components/common/Feedback';
import { showToast } from '@/features/ui/uiSlice';
import EmployeePicker from '@/components/common/EmployeePicker';
import { useApiAction, useApiResource } from '@/hooks/useApiResource';
import { payrollApi } from '@/services/api/services';
import { money } from '@/utils/format';
import { todayIso } from '@/utils/date';
import ClosableDialogTitle from '@/components/common/ClosableDialogTitle';

const EARNINGS = [
  { field: 'basic', label: 'Basic' },
  { field: 'hra', label: 'House rent allowance' },
  { field: 'conveyance_allowance', label: 'Conveyance' },
  { field: 'medical_allowance', label: 'Medical' },
  { field: 'special_allowance', label: 'Special allowance' },
] as const;

const DEDUCTIONS = [
  { field: 'provident_fund', label: 'Provident fund' },
  { field: 'professional_tax', label: 'Professional tax' },
  { field: 'income_tax', label: 'Income tax (TDS)' },
  { field: 'other_deductions', label: 'Other deductions' },
] as const;

const EMPTY = {
  employee: '',
  effective_from: todayIso(),
  basic: '',
  hra: '',
  conveyance_allowance: '',
  medical_allowance: '',
  special_allowance: '',
  provident_fund: '',
  professional_tax: '',
  income_tax: '',
  other_deductions: '',
  notes: '',
};

export default function SalaryStructuresTab() {
  const dispatch = useAppDispatch();
  const [page, setPage] = useState(0);
  const [currentOnly, setCurrentOnly] = useState('true');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });

  // Typing filters a table, so it should feel immediate - but not one request
  // per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, loading, error, reload } = useApiResource(
    useCallback(
      () =>
        payrollApi.structures({
          page: page + 1,
          page_size: 15,
          search: query || undefined,
          current: currentOnly === 'true' ? 'true' : undefined,
        }),
      [page, currentOnly, query],
    ),
    [page, currentOnly, query],
  );

  const create = useApiAction(payrollApi.createStructure);

  const preview = useMemo(() => {
    const sum = (fields: readonly { field: string }[]) =>
      fields.reduce(
        (total, { field }) => total + (Number(form[field as keyof typeof EMPTY]) || 0),
        0,
      );
    const gross = sum(EARNINGS);
    const deductions = sum(DEDUCTIONS);
    return { gross, deductions, net: gross - deductions };
  }, [form]);

  const set = (field: keyof typeof EMPTY) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [field]: event.target.value }));

  const handleCreate = async () => {
    const payload: Record<string, unknown> = {
      employee: Number(form.employee),
      effective_from: form.effective_from,
      notes: form.notes,
    };
    for (const { field } of [...EARNINGS, ...DEDUCTIONS]) {
      payload[field] = form[field as keyof typeof EMPTY] || '0';
    }

    const saved = await create.run(payload);
    if (saved) {
      dispatch(showToast(`Salary structure saved for ${saved.employee_name}.`, 'success'));
      setForm({ ...EMPTY });
      setOpen(false);
      void reload();
    }
  };

  return (
    <>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ sm: 'center' }}
        spacing={2}
        sx={{ p: 2 }}
      >
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ flexGrow: 1 }}>
          <TextField
            size="small"
            label="Search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, code, email or department"
            sx={{ minWidth: { sm: 300 } }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
          />
          <TextField
            select
            size="small"
            label="Show"
            value={currentOnly}
            onChange={(event) => {
              setCurrentOnly(event.target.value);
              setPage(0);
            }}
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="true">Current structures</MenuItem>
            <MenuItem value="false">All, including superseded</MenuItem>
          </TextField>
        </Stack>
        <Button startIcon={<AddIcon />} variant="contained" onClick={() => setOpen(true)}>
          New structure
        </Button>
      </Stack>

      {error && <ErrorAlert error={error} onRetry={reload} />}
      {loading ? (
        <LinearProgress />
      ) : !data?.results.length ? (
        <EmptyState
          title="No salary structures yet"
          detail="Payroll cannot run until employees have a structure in force."
        />
      ) : (
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Employee</TableCell>
                <TableCell>Effective</TableCell>
                <TableCell align="right">Gross / month</TableCell>
                <TableCell align="right">Deductions</TableCell>
                <TableCell align="right">Net / month</TableCell>
                <TableCell align="right">Annual CTC</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {data.results.map((row) => (
                <TableRow key={row.id} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>
                      {row.employee_name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {row.employee_code}
                      {row.department_name ? ` · ${row.department_name}` : ''}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {row.effective_from}
                    {row.effective_to && (
                      <Typography variant="caption" color="text.secondary" display="block">
                        to {row.effective_to}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">{money(row.gross_monthly)}</TableCell>
                  <TableCell align="right">{money(row.deductions_monthly)}</TableCell>
                  <TableCell align="right">
                    <strong>{money(row.net_monthly)}</strong>
                  </TableCell>
                  <TableCell align="right">{money(row.annual_ctc)}</TableCell>
                  <TableCell align="right">
                    {row.is_current ? (
                      <Chip size="small" color="success" label="Current" />
                    ) : (
                      <Chip size="small" variant="outlined" label="Superseded" />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {data && (
        <TablePagination
          component="div"
          count={data.count}
          page={page}
          onPageChange={(_, next) => setPage(next)}
          rowsPerPage={15}
          rowsPerPageOptions={[15]}
        />
      )}

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="md">
        <ClosableDialogTitle onClose={() => setOpen(false)}>
          New salary structure
        </ClosableDialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {create.error && !Object.keys(create.fieldErrors).length && (
              <Alert severity="error" onClose={create.clearError}>
                {create.error.message}
              </Alert>
            )}

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <Box sx={{ width: '100%' }}>
                <EmployeePicker
                  value={form.employee ? Number(form.employee) : null}
                  onChange={(employeeId) =>
                    setForm((current) => ({
                      ...current,
                      employee: employeeId === null ? '' : String(employeeId),
                    }))
                  }
                  required
                  error={Boolean(create.fieldErrors.employee)}
                  helperText={create.fieldErrors.employee ?? ' '}
                />
              </Box>
              <TextField
                label="Effective from"
                type="date"
                value={form.effective_from}
                onChange={set('effective_from')}
                required
                fullWidth
                slotProps={{ inputLabel: { shrink: true } }}
                error={Boolean(create.fieldErrors.effective_from)}
                helperText={
                  create.fieldErrors.effective_from ??
                  'Any earlier structure ends the day before.'
                }
              />
            </Stack>

            <Divider>
              <Typography variant="caption" color="text.secondary">
                MONTHLY EARNINGS
              </Typography>
            </Divider>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={2}
              flexWrap="wrap"
              useFlexGap
            >
              {EARNINGS.map(({ field, label }) => (
                <TextField
                  key={field}
                  label={label}
                  type="number"
                  value={form[field]}
                  onChange={set(field)}
                  size="small"
                  sx={{ flex: '1 1 180px' }}
                  error={Boolean(create.fieldErrors[field])}
                  helperText={create.fieldErrors[field] ?? ' '}
                />
              ))}
            </Stack>

            <Divider>
              <Typography variant="caption" color="text.secondary">
                MONTHLY DEDUCTIONS
              </Typography>
            </Divider>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={2}
              flexWrap="wrap"
              useFlexGap
            >
              {DEDUCTIONS.map(({ field, label }) => (
                <TextField
                  key={field}
                  label={label}
                  type="number"
                  value={form[field]}
                  onChange={set(field)}
                  size="small"
                  sx={{ flex: '1 1 180px' }}
                  error={Boolean(create.fieldErrors[field])}
                  helperText={create.fieldErrors[field] ?? ' '}
                />
              ))}
            </Stack>

            <Alert severity={preview.net > 0 ? 'info' : 'warning'}>
              Gross {money(preview.gross)} · deductions {money(preview.deductions)} ·{' '}
              <strong>net {money(preview.net)}</strong> per month ({money(preview.gross * 12)}{' '}
              annual CTC)
            </Alert>

            <TextField
              label="Notes"
              value={form.notes}
              onChange={set('notes')}
              multiline
              minRows={2}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreate}
            disabled={create.busy || !form.employee || preview.gross <= 0}
          >
            {create.busy ? 'Saving...' : 'Save structure'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
