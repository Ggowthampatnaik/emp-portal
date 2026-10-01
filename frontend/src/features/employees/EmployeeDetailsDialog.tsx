/**
 * Directory card, expanded.
 *
 * Opens over the directory rather than navigating, so looking someone up does
 * not lose your search. Everything shown comes from /employees/directory/{id}/,
 * which every signed-in user may read; opening the full HR record is a separate
 * button, and only appears for those who have the permission.
 */

import BadgeIcon from '@mui/icons-material/Badge';
import ApartmentIcon from '@mui/icons-material/Apartment';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import EmailIcon from '@mui/icons-material/Email';
import GroupsIcon from '@mui/icons-material/Groups';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PlaceIcon from '@mui/icons-material/Place';
import SupervisorAccountIcon from '@mui/icons-material/SupervisorAccount';
import WorkIcon from '@mui/icons-material/Work';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { SvgIconComponent } from '@mui/icons-material';
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAppDispatch } from '@/app/hooks';
import { ErrorAlert } from '@/components/common/Feedback';
import { showToast } from '@/features/ui/uiSlice';
import { usePermissions } from '@/hooks/usePermissions';
import { useApiResource } from '@/hooks/useApiResource';
import { employeesApi } from '@/services/api/services';
import { ROLES } from '@/types/auth';
import ClosableDialogTitle from '@/components/common/ClosableDialogTitle';

interface Props {
  employeeId: number | null;
  onClose: () => void;
  /** Lets a direct report be opened without closing and reopening the dialog. */
  onNavigate: (employeeId: number) => void;
}

/** One labelled row of the detail list. */
function DetailRow({
  icon: Icon,
  label,
  children,
}: {
  icon: SvgIconComponent;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Stack direction="row" spacing={2} alignItems="flex-start">
      <Icon fontSize="small" color="disabled" sx={{ mt: 0.3 }} />
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary" display="block">
          {label}
        </Typography>
        <Typography variant="body2" component="div">
          {children}
        </Typography>
      </Box>
    </Stack>
  );
}

function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  return Number.isNaN(date.valueOf())
    ? iso
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Whole years since the joining date, for the "N years with Trigyan" line. */
function tenure(iso: string): string | null {
  const start = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(start.valueOf())) return null;

  const now = new Date();
  let months =
    (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months -= 1;
  if (months < 0) return null;

  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return `${rest} month${rest === 1 ? '' : 's'} with Trigyan`;
  if (rest === 0) return `${years} year${years === 1 ? '' : 's'} with Trigyan`;
  return `${years}y ${rest}m with Trigyan`;
}

export default function EmployeeDetailsDialog({ employeeId, onClose, onNavigate }: Props) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { canAny, roles, isSuperAdmin } = usePermissions();
  /**
   * For the oversight roles this card *is* the record. Their Employees list
   * opens it instead of the page, and the page holds nothing more: Admin's is
   * the employment panel plus assets, and Super Admin's stops at employment and
   * contact. Offering "Open full record" would send either of them somewhere
   * with less on it than the card they are already reading. Equipment is issued
   * from Administration → Assets, which is where that job lives anyway. HR and
   * managers keep the link, because for them there is a fuller record behind it.
   */
  const summaryIsTheRecord = isSuperAdmin || roles.includes(ROLES.ADMIN);
  const mayOpenFullRecord =
    !summaryIsTheRecord && canAny('employee.view_team', 'employee.view_all');

  const { data, loading, error, reload } = useApiResource(
    useCallback(
      () => (employeeId ? employeesApi.directoryEntry(employeeId) : Promise.resolve(null)),
      [employeeId],
    ),
    [employeeId],
  );

  const copyEmail = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.email);
      dispatch(showToast('Email address copied.', 'success'));
    } catch {
      dispatch(showToast('Could not copy to the clipboard.', 'warning'));
    }
  };

  return (
    <Dialog open={employeeId !== null} onClose={onClose} maxWidth="sm" fullWidth>
      <Box sx={{ position: 'relative' }}>
        <ClosableDialogTitle onClose={onClose}>Employee details</ClosableDialogTitle>
        {loading && <LinearProgress />}

        <DialogContent>
          {error && <ErrorAlert error={error} onRetry={reload} />}

          {data && (
            <Stack spacing={3}>
              {/* Identity */}
              <Stack spacing={1.5} alignItems="center" textAlign="center">
                <Avatar
                  src={data.photo_url ?? undefined}
                  alt={data.full_name}
                  sx={{
                    width: 104,
                    height: 104,
                    fontSize: 36,
                    fontWeight: 700,
                    bgcolor: 'primary.main',
                  }}
                >
                  {data.full_name[0]?.toUpperCase()}
                </Avatar>
                <Box>
                  <Typography variant="h3" component="h2">
                    {data.full_name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {data.designation_name ?? 'No designation'}
                    {data.department_name ? ` · ${data.department_name}` : ''}
                  </Typography>
                </Box>
              </Stack>

              <Divider />

              <Stack spacing={2}>
                <DetailRow icon={BadgeIcon} label="Employee ID">
                  {data.employee_code}
                </DetailRow>

                <DetailRow icon={EmailIcon} label="Email">
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Link href={`mailto:${data.email}`} underline="hover">
                      {data.email}
                    </Link>
                    <Tooltip title="Copy email">
                      <IconButton
                        size="small"
                        onClick={copyEmail}
                        aria-label="Copy email address"
                      >
                        <ContentCopyIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </DetailRow>

                <DetailRow icon={ApartmentIcon} label="Department">
                  {data.department_name ?? 'Not assigned'}
                </DetailRow>

                <DetailRow icon={WorkIcon} label="Designation">
                  {data.designation_name ?? 'Not assigned'}
                </DetailRow>

                <DetailRow icon={SupervisorAccountIcon} label="Reporting manager">
                  {data.reporting_manager && data.reporting_manager_name ? (
                    <Link
                      component="button"
                      type="button"
                      underline="hover"
                      onClick={() => onNavigate(data.reporting_manager!)}
                      sx={{ font: 'inherit' }}
                    >
                      {data.reporting_manager_name}
                    </Link>
                  ) : (
                    'None'
                  )}
                </DetailRow>

                <DetailRow icon={GroupsIcon} label="Direct reports">
                  {data.direct_reports.length === 0 ? (
                    'None'
                  ) : (
                    <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                      {data.direct_reports.map((report) => (
                        <Stack
                          key={report.id}
                          direction="row"
                          spacing={1}
                          alignItems="center"
                          component="button"
                          type="button"
                          onClick={() => onNavigate(report.id)}
                          sx={{
                            background: 'none',
                            border: 0,
                            p: 0.5,
                            borderRadius: 1,
                            cursor: 'pointer',
                            textAlign: 'left',
                            '&:hover': { bgcolor: 'action.hover' },
                          }}
                        >
                          <Avatar
                            src={report.photo_url ?? undefined}
                            alt={report.full_name}
                            sx={{
                              width: 26,
                              height: 26,
                              fontSize: 12,
                              bgcolor: 'primary.light',
                            }}
                          >
                            {report.full_name[0]?.toUpperCase()}
                          </Avatar>
                          <Typography variant="body2">{report.full_name}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {report.designation_name ?? report.employee_code}
                          </Typography>
                        </Stack>
                      ))}
                    </Stack>
                  )}
                </DetailRow>

                <DetailRow icon={CalendarMonthIcon} label="Date of joining">
                  {formatDate(data.date_of_joining)}
                  {tenure(data.date_of_joining) && (
                    <Typography variant="caption" color="text.secondary" display="block">
                      {tenure(data.date_of_joining)}
                    </Typography>
                  )}
                </DetailRow>

                <DetailRow icon={PlaceIcon} label="Work location">
                  {data.work_location || 'Not recorded'}
                </DetailRow>
              </Stack>
            </Stack>
          )}
        </DialogContent>
      </Box>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        {mayOpenFullRecord && data && (
          <Button
            startIcon={<OpenInNewIcon />}
            onClick={() => {
              onClose();
              navigate(`/employees/${data.id}`);
            }}
          >
            Open full record
          </Button>
        )}
        <Box sx={{ flexGrow: 1 }} />
        <Button onClick={onClose} variant="contained">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
