/**
 * Payslips by project: project → employee → year → month.
 *
 * HR's question here is "what is this project costing?", which the payroll runs
 * cannot answer because they are organised by month, not by team. The four
 * levels are deliberate: each one narrows the set before the next request goes
 * out, so no screen ever pulls the whole company's pay.
 *
 * The project filter matches who is *currently* on a project. Staffing history
 * is not recorded per month, so a payslip from before someone joined the
 * project will still be listed under it — the column headers say which month
 * each payslip is for, so this is visible rather than hidden.
 */

import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos';
import DownloadIcon from '@mui/icons-material/Download';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import LinearProgress from '@mui/material/LinearProgress';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useMemo, useState } from 'react';

import { EmptyState, ErrorAlert } from '@/components/common/Feedback';
import PayslipBreakdown from '@/features/payroll/PayslipBreakdown';
import { usePayslipDownload } from '@/features/payroll/usePayslipDownload';
import { useApiResource } from '@/hooks/useApiResource';
import { payrollApi, projectsApi } from '@/services/api/services';
import { money } from '@/utils/format';
import type { Payslip } from '@/types/domain';

/** One column of the drill-down. */
function Column({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <Box sx={{ minWidth: 0, flex: 1 }}>
      <Typography variant="subtitle2" color="text.secondary">
        {title}
      </Typography>
      {subtitle && (
        <Typography variant="caption" color="text.disabled" display="block">
          {subtitle}
        </Typography>
      )}
      <Divider sx={{ my: 1 }} />
      {children}
    </Box>
  );
}

export default function ProjectPayslipsTab() {
  const [projectId, setProjectId] = useState<number | null>(null);
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [payslipId, setPayslipId] = useState<number | null>(null);
  const { download, busy } = usePayslipDownload();

  const projects = useApiResource(
    useCallback(() => projectsApi.list({ page_size: 100 }), []),
    [],
  );

  /** Every payslip belonging to anyone currently on the chosen project. */
  const slips = useApiResource(
    useCallback(
      () =>
        projectId
          ? payrollApi.payslips({ project: projectId, page_size: 500 })
          : Promise.resolve(null),
      [projectId],
    ),
    [projectId],
  );

  const rows = useMemo(() => slips.data?.results ?? [], [slips.data]);

  /** People on the project who have at least one payslip. */
  const people = useMemo(() => {
    const seen = new Map<number, { id: number; name: string; code: string; count: number }>();
    for (const slip of rows) {
      const entry = seen.get(slip.employee);
      if (entry) {
        entry.count += 1;
      } else {
        seen.set(slip.employee, {
          id: slip.employee,
          name: slip.employee_name,
          code: slip.employee_code,
          count: 1,
        });
      }
    }
    return [...seen.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [rows]);

  const forEmployee = rows.filter((slip) => slip.employee === employeeId);
  const years = [...new Set(forEmployee.map((slip) => slip.year))].sort((a, b) => b - a);
  const activeYear = year ?? years[0] ?? null;
  const months = forEmployee.filter((slip) => slip.year === activeYear);
  const selected: Payslip | undefined = months.find((slip) => slip.id === payslipId);

  const chooseProject = (id: number) => {
    setProjectId(id);
    setEmployeeId(null);
    setYear(null);
    setPayslipId(null);
  };

  return (
    <Box sx={{ p: 2 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
        <TextField
          select
          size="small"
          label="Project"
          value={projectId ?? ''}
          onChange={(event) => chooseProject(Number(event.target.value))}
          sx={{ minWidth: 280 }}
          helperText="Payslips of everyone currently on the project."
        >
          {(projects.data?.results ?? []).map((project) => (
            <MenuItem key={project.id} value={project.id}>
              {project.code} — {project.name}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      {projects.error && <ErrorAlert error={projects.error} onRetry={projects.reload} />}
      {slips.error && <ErrorAlert error={slips.error} onRetry={slips.reload} />}
      {slips.loading && <LinearProgress sx={{ mb: 2 }} />}

      {!projectId ? (
        <EmptyState title="Pick a project" detail="Then drill down: employee, year, month." />
      ) : people.length === 0 && !slips.loading ? (
        <EmptyState
          title="No payslips for this project"
          detail="Nobody currently on it has an approved payslip yet."
        />
      ) : (
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={3}
          divider={<Divider orientation="vertical" flexItem />}
        >
          <Column title="Employee" subtitle={`${people.length} on this project`}>
            <List dense disablePadding>
              {people.map((person) => (
                <ListItemButton
                  key={person.id}
                  selected={person.id === employeeId}
                  onClick={() => {
                    setEmployeeId(person.id);
                    setYear(null);
                    setPayslipId(null);
                  }}
                >
                  <ListItemText primary={person.name} secondary={person.code} />
                  <Chip size="small" label={person.count} />
                  <ArrowForwardIosIcon sx={{ fontSize: 12, ml: 1, color: 'text.disabled' }} />
                </ListItemButton>
              ))}
            </List>
          </Column>

          <Column title="Year">
            {employeeId === null ? (
              <Typography variant="body2" color="text.disabled">
                Pick someone first.
              </Typography>
            ) : (
              <List dense disablePadding>
                {years.map((entry) => (
                  <ListItemButton
                    key={entry}
                    selected={entry === activeYear}
                    onClick={() => {
                      setYear(entry);
                      setPayslipId(null);
                    }}
                  >
                    <ListItemText primary={entry} />
                  </ListItemButton>
                ))}
              </List>
            )}
          </Column>

          <Column title="Month">
            {employeeId === null ? (
              <Typography variant="body2" color="text.disabled">
                —
              </Typography>
            ) : (
              <List dense disablePadding>
                {months.map((slip) => (
                  <ListItemButton
                    key={slip.id}
                    selected={slip.id === payslipId}
                    onClick={() => setPayslipId(slip.id)}
                  >
                    <ListItemText primary={slip.period_label} secondary={money(slip.net_pay)} />
                  </ListItemButton>
                ))}
              </List>
            )}
          </Column>
        </Stack>
      )}

      {selected && (
        <>
          <Divider sx={{ my: 3 }} />
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            justifyContent="space-between"
            alignItems={{ sm: 'center' }}
            spacing={1}
            sx={{ mb: 2 }}
          >
            <Typography variant="h4">
              {selected.employee_name} · {selected.period_label}
            </Typography>
            <Button
              variant="outlined"
              startIcon={<DownloadIcon />}
              onClick={() => void download(selected.id, selected.period_label)}
              disabled={busy}
            >
              {busy ? 'Preparing...' : 'Download PDF'}
            </Button>
          </Stack>
          <PayslipBreakdown slip={selected} />
        </>
      )}
    </Box>
  );
}
