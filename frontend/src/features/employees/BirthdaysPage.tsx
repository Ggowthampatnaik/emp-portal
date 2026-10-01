/**
 * The company birthday calendar, grouped month by month.
 *
 * Open to everyone — this is where "View more" on the dashboard birthday card
 * lands, the same arrangement as the holiday card and its calendar. The grid
 * of twelve month cards is the same frame as the Holidays page, so the two
 * destinations read as siblings; the rows inside are the dashboard card's
 * birthday rows, so a person looks the same wherever their birthday appears.
 *
 * There is no year picker where Holidays has one: birthdays recur, so "the
 * next twelve months" is the whole story, and the server already orders it.
 * Months are laid out January to December, not soonest-first — a calendar,
 * not a queue — with the current month leading the eye the same way the
 * Holidays page does it.
 */

import CakeIcon from '@mui/icons-material/Cake';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useCallback, useMemo, useState } from 'react';

import { CardGridSkeleton, ErrorAlert } from '@/components/common/Feedback';
import PageHeader from '@/components/common/PageHeader';
import EmployeeDetailsDialog from '@/features/employees/EmployeeDetailsDialog';

import { useApiResource } from '@/hooks/useApiResource';
import { reportsApi } from '@/services/api/services';
import type { UpcomingBirthday } from '@/types/domain';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * `days_until` counts to the *next* occurrence, so a birthday earlier this
 * month is nearly a year away. Printing that under a card badged "This month"
 * read as a contradiction — 6 August shown as "in 340 days" beside the words
 * "This month" — so a birthday already past this year says so instead.
 */
function whenLabel(person: UpcomingBirthday, currentMonth: number): string {
  if (person.days_until === 0) return 'Today';
  if (person.days_until === 1) return 'Tomorrow';
  if (person.month - 1 === currentMonth && person.days_until > 300) return 'Earlier this month';
  return `in ${person.days_until} days`;
}

function BirthdayRow({
  person,
  currentMonth,
  onOpen,
}: {
  person: UpcomingBirthday;
  currentMonth: number;
  onOpen: () => void;
}) {
  // Opens the person's directory card - the same dialog the company directory
  // uses, readable by every signed-in user. It carries work details only and
  // offers "Open full record" just to the roles that may see it, so the row
  // is clickable for everyone without dropping anyone on /forbidden.
  return (
    <Stack
      direction="row"
      spacing={1.5}
      alignItems="center"
      component="button"
      type="button"
      onClick={onOpen}
      sx={{
        py: 1.25,
        px: 1,
        mx: -1,
        width: 'calc(100% + 16px)',
        textAlign: 'left',
        background: 'none',
        border: 0,
        cursor: 'pointer',
        color: 'inherit',
        borderRadius: 1.5,
        transition: 'background-color 120ms ease',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Avatar
        src={person.photo_url ?? undefined}
        alt={person.full_name}
        sx={{
          width: 40,
          height: 40,
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
        {/* Two lines rather than an ellipsis: "Senior Software Engineer ·
            Eng…" told the reader less than the role is worth. */}
        <Typography
          variant="caption"
          color="text.secondary"
          display="block"
          sx={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {person.designation_name ?? person.employee_code}
          {person.department_name ? ` · ${person.department_name}` : ''}
        </Typography>
      </Box>

      <Stack alignItems="flex-end" spacing={0.5} sx={{ flexShrink: 0 }}>
        <Typography variant="caption" fontWeight={700}>
          {person.day} {MONTHS[person.month - 1]?.slice(0, 3)}
        </Typography>
        <Chip
          size="small"
          label={person.is_today ? '🎂 Today' : whenLabel(person, currentMonth)}
          color={person.is_today ? 'secondary' : 'default'}
          variant={person.is_today ? 'filled' : 'outlined'}
        />
      </Stack>
    </Stack>
  );
}

export default function BirthdaysPage() {
  const [selected, setSelected] = useState<number | null>(null);
  // Latched on the first open. Mounting the dialog up front would run its
  // idle load cycle on every visit for nothing, but unmounting it on close
  // would cut the closing animation short.
  const [dialogUsed, setDialogUsed] = useState(false);
  const { data, loading, error, reload } = useApiResource(
    useCallback(() => reportsApi.birthdays(), []),
    [],
  );

  const openPerson = (id: number) => {
    setDialogUsed(true);
    setSelected(id);
  };

  /** Birthdays bucketed into the twelve months, soonest first within each. */
  const byMonth = useMemo(() => {
    const buckets: UpcomingBirthday[][] = Array.from({ length: 12 }, () => []);
    for (const person of data?.results ?? []) {
      buckets[person.month - 1]?.push(person);
    }
    for (const bucket of buckets) bucket.sort((a, b) => a.days_until - b.days_until);
    return buckets;
  }, [data]);

  const currentMonth = new Date().getMonth();

  return (
    <>
      <PageHeader
        title="Birthdays"
        subtitle={`${data?.count ?? 0} across the company, through the year`}
      />

      {error && <ErrorAlert error={error} onRetry={reload} />}
      {loading && !data && <CardGridSkeleton cards={6} height={190} />}
      {loading && data && <LinearProgress sx={{ mb: 2 }} />}

      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' },
          // Twelve cards of one size, however many birthdays a month holds.
          // `1fr` rows all take the height of the busiest one, and without
          // `alignItems: start` each card fills the cell it is given - so a
          // quiet month sits level with the month beside it instead of
          // stopping short and leaving the row ragged.
          gridAutoRows: '1fr',
        }}
      >
        {MONTHS.map((month, index) => {
          const birthdays = byMonth[index] ?? [];
          const isCurrent = index === currentMonth;

          return (
            <Card
              key={month}
              sx={{
                borderColor: isCurrent ? 'primary.main' : undefined,
                borderWidth: isCurrent ? 2 : 1,
              }}
            >
              <CardContent>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                  <CakeIcon
                    fontSize="small"
                    color={birthdays.length ? 'secondary' : 'disabled'}
                  />
                  <Typography variant="subtitle2" fontWeight={700}>
                    {month}
                  </Typography>
                  {isCurrent && <Chip size="small" color="primary" label="This month" />}
                  <Box sx={{ flexGrow: 1 }} />
                  <Typography variant="caption" color="text.secondary">
                    {birthdays.length || 'none'}
                  </Typography>
                </Stack>

                {birthdays.length === 0 ? (
                  <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                    No birthdays in {month}.
                  </Typography>
                ) : (
                  <Stack divider={<Divider flexItem />}>
                    {birthdays.map((person) => (
                      <BirthdayRow
                        key={person.id}
                        person={person}
                        currentMonth={currentMonth}
                        onOpen={() => openPerson(person.id)}
                      />
                    ))}
                  </Stack>
                )}
              </CardContent>
            </Card>
          );
        })}
      </Box>

      {dialogUsed && (
        <EmployeeDetailsDialog
          employeeId={selected}
          onClose={() => setSelected(null)}
          onNavigate={setSelected}
        />
      )}
    </>
  );
}
