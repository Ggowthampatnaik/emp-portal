/**
 * The holiday calendar as a month view, laid out the way Outlook's is: one
 * month at a time, a full-width grid of six weeks, and each holiday drawn as a
 * named bar inside the day it falls on rather than a dot you have to hover.
 *
 * The list view answers "what are the holidays"; this answers "how does the
 * month sit" - what a long weekend looks like, which closures land midweek.
 * Weeks start on Monday, matching the timesheet.
 */

import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';

import { monthCells, WEEKS_SHOWN } from '@/features/leave/monthGrid';
import type { Holiday } from '@/types/domain';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const MONTH_NAMES = [
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

export default function HolidayCalendar({
  year,
  month,
  onMonthChange,
  holidays,
  todayIso,
  onSelect,
}: {
  year: number;
  month: number;
  onMonthChange: (month: number) => void;
  holidays: Holiday[];
  todayIso: string;
  onSelect?: (holiday: Holiday) => void;
}) {
  const cells = monthCells(year, month, holidays, todayIso);
  const todayMonth = Number(todayIso.slice(5, 7)) - 1;
  const isThisYear = Number(todayIso.slice(0, 4)) === year;

  return (
    <Box>
      {/* The month bar: where you are, and the two ways to move. Arrows stop at
          the ends of the year because the year picker above owns the year. */}
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
        <IconButton
          size="small"
          aria-label="Previous month"
          disabled={month === 0}
          onClick={() => onMonthChange(month - 1)}
        >
          <ChevronLeftIcon />
        </IconButton>
        <IconButton
          size="small"
          aria-label="Next month"
          disabled={month === 11}
          onClick={() => onMonthChange(month + 1)}
        >
          <ChevronRightIcon />
        </IconButton>
        <Typography variant="h4" component="h2" sx={{ ml: 0.5 }}>
          {MONTH_NAMES[month]} {year}
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        {isThisYear && month !== todayMonth && (
          <Button size="small" onClick={() => onMonthChange(todayMonth)}>
            Today
          </Button>
        )}
      </Stack>

      <Box
        sx={(theme) => ({
          border: 1,
          borderColor: theme.palette.divider,
          borderRadius: 2,
          overflow: 'hidden',
        })}
      >
        {/* Day names, once, across the top. */}
        <Box
          sx={(theme) => ({
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            bgcolor: theme.palette.action.hover,
            borderBottom: 1,
            borderColor: theme.palette.divider,
          })}
        >
          {WEEKDAYS.map((name) => (
            <Typography
              key={name}
              variant="caption"
              sx={{ py: 0.75, px: 1, fontWeight: 700, color: 'text.secondary' }}
            >
              {name}
            </Typography>
          ))}
        </Box>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gridTemplateRows: `repeat(${WEEKS_SHOWN}, minmax(92px, auto))`,
          }}
        >
          {cells.map((cell, index) => {
            const { holiday } = cell;
            const clickable = Boolean(holiday && onSelect);

            return (
              <Box
                key={cell.date}
                sx={(theme) => ({
                  p: 0.75,
                  minWidth: 0,
                  borderRight: index % 7 === 6 ? 0 : 1,
                  borderBottom: index >= (WEEKS_SHOWN - 1) * 7 ? 0 : 1,
                  borderColor: theme.palette.divider,
                  // A day outside this month is context, not content, and a
                  // weekend is shaded the way a calendar shades one. Both are
                  // faint on purpose: the month itself has to stay the
                  // brightest thing on the grid. Mixed off the text colour so
                  // they invert with the theme rather than staying grey.
                  bgcolor: !cell.inMonth
                    ? alpha(theme.palette.text.primary, 0.05)
                    : cell.isWeekend
                      ? alpha(theme.palette.text.primary, 0.02)
                      : 'transparent',
                })}
              >
                <Stack direction="row" justifyContent="flex-end" sx={{ mb: 0.5 }}>
                  <Box
                    sx={(theme) => ({
                      minWidth: 22,
                      height: 22,
                      px: 0.5,
                      borderRadius: '999px',
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 12,
                      fontVariantNumeric: 'tabular-nums',
                      // Today is the filled pill Outlook uses, so it reads
                      // even on a day that carries nothing else.
                      ...(cell.isToday
                        ? {
                            bgcolor: theme.palette.secondary.main,
                            color: theme.palette.secondary.contrastText,
                            fontWeight: 700,
                          }
                        : {
                            color: cell.inMonth
                              ? theme.palette.text.primary
                              : theme.palette.text.disabled,
                          }),
                    })}
                  >
                    {cell.day}
                  </Box>
                </Stack>

                {holiday && (
                  <Box
                    component={clickable ? 'button' : 'div'}
                    type={clickable ? 'button' : undefined}
                    onClick={clickable ? () => onSelect?.(holiday) : undefined}
                    title={holiday.name}
                    aria-label={clickable ? `${holiday.name}, ${cell.date}` : undefined}
                    sx={(theme) => ({
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      font: 'inherit',
                      fontSize: 12,
                      lineHeight: 1.3,
                      px: 0.75,
                      py: 0.5,
                      borderRadius: 1,
                      cursor: clickable ? 'pointer' : 'default',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      // A closure is a filled bar; an optional holiday is an
                      // outlined one, because it is a day you may take rather
                      // than one the office is shut.
                      ...(holiday.is_optional
                        ? {
                            border: `1px solid ${theme.palette.primary.main}`,
                            color: theme.palette.primary.main,
                            bgcolor: alpha(theme.palette.primary.main, 0.06),
                          }
                        : {
                            border: '1px solid transparent',
                            bgcolor: theme.palette.primary.main,
                            color: theme.palette.primary.contrastText,
                            fontWeight: 600,
                          }),
                      ...(clickable && {
                        '&:hover': {
                          bgcolor: holiday.is_optional
                            ? alpha(theme.palette.primary.main, 0.16)
                            : theme.palette.primary.dark,
                        },
                      }),
                    })}
                  >
                    {holiday.name}
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
