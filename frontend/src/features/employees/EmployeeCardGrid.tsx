/**
 * The employee list as cards - the same card the Company Directory uses, so
 * the two tabs read as one directory rather than two designs that happen to
 * share a page. The one difference is where a click lands: the directory
 * opens the read-only details dialog, while this view opens the full record,
 * because the people who see this tab are the people who work on records.
 */

import EmailIcon from '@mui/icons-material/Email';
import PlaceIcon from '@mui/icons-material/Place';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import type { EmployeeListItem } from '@/types/domain';
import { identityChipSx } from '@/styles/identity';

function EmployeeCard({
  employee,
  onOpen,
}: {
  employee: EmployeeListItem;
  onOpen: () => void;
}) {
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardActionArea onClick={onOpen} sx={{ height: '100%' }}>
        <CardContent sx={{ height: '100%' }}>
          <Stack direction="row" spacing={2} alignItems="flex-start">
            <Avatar
              src={employee.photo_url ?? undefined}
              alt={employee.full_name}
              sx={{ width: 48, height: 48, bgcolor: 'primary.light', fontWeight: 700 }}
            >
              {employee.full_name[0]?.toUpperCase()}
            </Avatar>

            <Box sx={{ minWidth: 0, flexGrow: 1 }}>
              <Typography variant="body1" fontWeight={700} noWrap title={employee.full_name}>
                {employee.full_name}
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block">
                {employee.employee_code}
                {employee.designation_name ? ` · ${employee.designation_name}` : ''}
              </Typography>

              <Stack direction="row" spacing={0.5} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
                {employee.department_name && (
                  <Chip
                    size="small"
                    label={employee.department_name}
                    sx={identityChipSx(employee.department_name)}
                  />
                )}
                {employee.work_location && (
                  <Chip
                    size="small"
                    variant="outlined"
                    icon={<PlaceIcon fontSize="small" />}
                    label={employee.work_location}
                  />
                )}
              </Stack>

              <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 1 }}>
                <EmailIcon fontSize="inherit" color="disabled" />
                <Typography
                  variant="caption"
                  color="text.secondary"
                  noWrap
                  title={employee.email}
                >
                  {employee.email}
                </Typography>
              </Stack>

              {employee.reporting_manager_name && (
                <Typography
                  variant="caption"
                  color="text.disabled"
                  display="block"
                  sx={{ mt: 0.5 }}
                >
                  Reports to {employee.reporting_manager_name}
                </Typography>
              )}
            </Box>
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

export default function EmployeeCardGrid({
  employees,
  onOpenProfile,
}: {
  employees: EmployeeListItem[];
  onOpenProfile: (id: number) => void;
}) {
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        p: 2,
        gridTemplateColumns: {
          xs: '1fr',
          sm: 'repeat(2, 1fr)',
          md: 'repeat(3, 1fr)',
        },
        alignItems: 'stretch',
      }}
    >
      {employees.map((employee) => (
        <EmployeeCard
          key={employee.id}
          employee={employee}
          onOpen={() => onOpenProfile(employee.id)}
        />
      ))}
    </Box>
  );
}
