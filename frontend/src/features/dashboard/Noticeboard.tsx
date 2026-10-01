/**
 * The dashboard noticeboard: upcoming birthdays and company holidays.
 *
 * Company-wide and identical for every role, so it renders from the shared
 * dashboard summary rather than fetching anything of its own. Birthdays carry
 * day and month only — the API never sends a birth year.
 *
 * The two cards are a matched pair, and four things keep them that way: the
 * same window (the next 30 days, scoped on the server), the
 * same row cap, the same frame (`SectionCard`, which fills its grid cell so
 * both cards are one height and pins the footer so both "View more" links sit
 * on the same line), and leading badges of the same width, so the text columns
 * line up across the gap between the cards.
 */

import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import CakeIcon from '@mui/icons-material/Cake';
import EventIcon from '@mui/icons-material/Event';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';

import SectionCard from '@/components/common/SectionCard';
import EmployeeDetailsDialog from '@/features/employees/EmployeeDetailsDialog';
import { SLATE } from '@/styles/theme';
import type { UpcomingBirthday, UpcomingHoliday } from '@/types/domain';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Both cards lead with something this wide, so their text columns align. */
const BADGE = 44;

/** "Today", "Tomorrow", or "in N days" — the phrasing people actually use. */
function whenLabel(daysUntil: number): string {
  if (daysUntil === 0) return 'Today';
  if (daysUntil === 1) return 'Tomorrow';
  return `in ${daysUntil} days`;
}

/** A small square date badge, like a torn-off calendar page. */
function DateBadge({
  day,
  month,
  highlight,
}: {
  day: number;
  month: number;
  highlight: boolean;
}) {
  return (
    <Box
      sx={{
        width: BADGE,
        flexShrink: 0,
        textAlign: 'center',
        borderRadius: 1.5,
        overflow: 'hidden',
        border: 1,
        borderColor: highlight ? 'secondary.main' : 'divider',
      }}
    >
      <Typography
        variant="caption"
        sx={{
          display: 'block',
          bgcolor: (theme) =>
            highlight
              ? theme.palette.secondary.main
              : theme.palette.mode === 'light'
                ? SLATE.tint
                : SLATE.tintDark,
          color: (theme) =>
            highlight
              ? theme.palette.secondary.contrastText
              : theme.palette.mode === 'light'
                ? SLATE.tintInk
                : SLATE.tintInkDark,
          fontWeight: 700,
          fontSize: 10,
          letterSpacing: '0.08em',
          py: 0.25,
        }}
      >
        {MONTHS[month - 1]?.toUpperCase()}
      </Typography>
      <Typography variant="body2" fontWeight={700} sx={{ py: 0.25 }}>
        {day}
      </Typography>
    </Box>
  );
}

/** The list, or one line saying why there isn't one. Same shape in both cards. */
function NoticeList({ empty, children }: { empty: string; children: ReactNode[] }) {
  if (children.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
        {empty}
      </Typography>
    );
  }
  return <Stack divider={<Divider flexItem />}>{children}</Stack>;
}

function ViewMore({ to }: { to: string }) {
  return (
    <Button
      component={RouterLink}
      to={to}
      size="small"
      endIcon={<ArrowForwardIcon fontSize="small" />}
    >
      View more
    </Button>
  );
}

/**
 * A noticeboard row that opens the person's directory card - the same dialog
 * the company directory uses, which every signed-in user may read. The card
 * carries work details only and offers "Open full record" just to the roles
 * that hold `employee.view_team` / `view_all`, so the row can be clickable
 * for everyone and each viewer still sees exactly as much as they should.
 */
function PersonRow({ onOpen, children }: { onOpen: () => void; children: ReactNode }) {
  return (
    <Box
      component="button"
      type="button"
      onClick={onOpen}
      sx={{
        display: 'block',
        // A button does not stretch like a block link; the width puts back
        // what the negative margins pull the hover surface out by.
        width: 'calc(100% + 16px)',
        textAlign: 'left',
        background: 'none',
        border: 0,
        cursor: 'pointer',
        color: 'inherit',
        py: 1.25,
        px: 1,
        mx: -1,
        borderRadius: 1.5,
        transition: 'background-color 120ms ease',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      {children}
    </Box>
  );
}

export default function Noticeboard({
  birthdays,
  holidays,
}: {
  birthdays: UpcomingBirthday[];
  holidays: UpcomingHoliday[];
}) {
  const [selected, setSelected] = useState<number | null>(null);
  // Latched on the first open. Mounting the dialog up front would run its
  // idle load cycle on every dashboard visit for nothing, but unmounting it
  // on close would cut the closing animation short.
  const [dialogUsed, setDialogUsed] = useState(false);

  const openPerson = (id: number) => {
    setDialogUsed(true);
    setSelected(id);
  };

  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' },
        // No `alignItems: 'start'` — the default stretch is what lets both
        // cards fill the row and so come out the same height.
      }}
    >
      <SectionCard
        title="Upcoming birthdays"
        icon={<CakeIcon color="secondary" />}
        subtitle="Company-wide, over the next 30 days."
        count={birthdays.length}
        footer={<ViewMore to="/birthdays" />}
      >
        <NoticeList empty="No birthdays in the next 30 days.">
          {birthdays.map((person) => (
            <PersonRow key={person.id} onOpen={() => openPerson(person.id)}>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Avatar
                  src={person.photo_url ?? undefined}
                  alt={person.full_name}
                  sx={{
                    width: BADGE,
                    height: BADGE,
                    flexShrink: 0,
                    fontSize: 15,
                    fontWeight: 700,
                    bgcolor: person.is_today ? 'secondary.main' : 'primary.light',
                  }}
                >
                  {person.full_name[0]?.toUpperCase()}
                </Avatar>

                <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                  <Typography variant="body2" fontWeight={600} noWrap title={person.full_name}>
                    {person.full_name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap display="block">
                    {person.designation_name ?? person.employee_code}
                    {person.department_name ? ` · ${person.department_name}` : ''}
                  </Typography>
                </Box>

                <Stack alignItems="flex-end" spacing={0.5} sx={{ flexShrink: 0 }}>
                  <Typography variant="caption" fontWeight={700}>
                    {person.day} {MONTHS[person.month - 1]}
                  </Typography>
                  <Chip
                    size="small"
                    label={person.is_today ? '🎂 Today' : whenLabel(person.days_until)}
                    color={person.is_today ? 'secondary' : 'default'}
                    variant={person.is_today ? 'filled' : 'outlined'}
                  />
                </Stack>
              </Stack>
            </PersonRow>
          ))}
        </NoticeList>
      </SectionCard>

      <SectionCard
        title="Upcoming holidays"
        icon={<EventIcon color="primary" />}
        subtitle="Company-wide, over the next 30 days."
        count={holidays.length}
        footer={<ViewMore to="/holidays" />}
      >
        <NoticeList empty="No holidays in the next 30 days.">
          {holidays.map((holiday) => {
            const [year, month, day] = holiday.date.split('-').map(Number);
            return (
              <Stack
                key={holiday.id}
                direction="row"
                spacing={1.5}
                alignItems="center"
                sx={{ py: 1.25 }}
              >
                <DateBadge day={day} month={month} highlight={holiday.is_today} />

                <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                  <Typography variant="body2" fontWeight={600} noWrap title={holiday.name}>
                    {holiday.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {holiday.day_of_week}
                    {year !== new Date().getFullYear() ? ` ${year}` : ''}
                    {holiday.is_optional ? ' · optional' : ''}
                  </Typography>
                  {holiday.description && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      title={holiday.description}
                      sx={{
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        mt: 0.25,
                      }}
                    >
                      {holiday.description}
                    </Typography>
                  )}
                </Box>

                <Chip
                  size="small"
                  label={whenLabel(holiday.days_until)}
                  color={holiday.is_today ? 'primary' : 'default'}
                  variant={holiday.is_today ? 'filled' : 'outlined'}
                  sx={{ flexShrink: 0 }}
                />
              </Stack>
            );
          })}
        </NoticeList>
      </SectionCard>

      {dialogUsed && (
        <EmployeeDetailsDialog
          employeeId={selected}
          onClose={() => setSelected(null)}
          onNavigate={setSelected}
        />
      )}
    </Box>
  );
}
