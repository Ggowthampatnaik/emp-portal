/**
 * Role-aware dashboard. Every number comes from one request to
 * /dashboard/summary/, which returns only the sections the caller may see.
 */

import ApartmentIcon from '@mui/icons-material/Apartment';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import GroupsIcon from '@mui/icons-material/Groups';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import ScheduleIcon from '@mui/icons-material/Schedule';
import WorkIcon from '@mui/icons-material/Work';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import LinearProgress from '@mui/material/LinearProgress';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { alpha, type Theme } from '@mui/material/styles';
import type { SvgIconComponent } from '@mui/icons-material';
import { useCallback, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Link as RouterLink } from 'react-router-dom';

import { useAppSelector } from '@/app/hooks';
import { CardGridSkeleton, ErrorAlert } from '@/components/common/Feedback';
import PageHeader from '@/components/common/PageHeader';
import StatusChip from '@/components/common/StatusChip';
import { selectCurrentUser } from '@/features/auth/authSlice';
import Noticeboard from '@/features/dashboard/Noticeboard';
import ApplyLeaveDialog from '@/features/leave/ApplyLeaveDialog';
import { useApiResource } from '@/hooks/useApiResource';
import { reportsApi } from '@/services/api/services';
import { CARD_SHADOW } from '@/styles/theme';
import { identityHue } from '@/styles/identity';
import { formatDate } from '@/utils/date';

/**
 * Whether a card is asking for something.
 *
 * One signal, not a palette. Cards used to carry a green / navy / amber rail
 * for "your entitlement" / "information" / "work waiting", which is systematic
 * but not legible: nothing on the page says what the colours mean, and the
 * green-versus-navy distinction was not one a reader needed making. Now amber
 * means exactly one thing - this is waiting on you - and everything else is
 * left plain.
 *
 * The signal is the rail's *presence*, not its hue, so it still reads for
 * anyone who cannot separate amber from navy.
 */
type Tone = 'neutral' | 'attention';

/**
 * A heading over a band of cards.
 *
 * The three bands on this page - what is mine, what is waiting on me, what the
 * company looks like - were told apart only by their words, at the same weight
 * as everything else. A short rule in the brand blue gives each band a start,
 * which is most of what makes a long page scannable.
 */
function BandHeading({ children }: { children: string }) {
  return (
    <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 1.5 }}>
      <Box sx={{ width: 3, height: 18, borderRadius: 3, bgcolor: 'primary.main' }} />
      <Typography variant="h4" component="h2">
        {children}
      </Typography>
    </Stack>
  );
}

/**
 * The dashboard's three openings.
 *
 * Written for a light ground like every other page's actions; the header panel
 * dresses them for the navy, so the emphasis - one filled, two outlined - is
 * declared once here and rendered consistently with every other page.
 */
function QuickActions({ onApply }: { onApply: () => void }) {
  return (
    <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
      <Button onClick={onApply} variant="contained" startIcon={<EventAvailableIcon />}>
        Apply for leave
      </Button>
      <Button
        component={RouterLink}
        to="/timesheets"
        variant="outlined"
        startIcon={<ScheduleIcon />}
      >
        Fill timesheet
      </Button>
      <Button
        component={RouterLink}
        to="/payroll"
        variant="outlined"
        startIcon={<ReceiptLongIcon />}
      >
        View payslip
      </Button>
    </Stack>
  );
}

/** True for the values that mean "nothing here": 0, 0.0, 0.00 h, 0.0 d. */
function isNothing(value: string): boolean {
  return /^0([.,]0+)?\s*[a-z]?$/i.test(value.trim());
}

/** Attention only counts while there is actually something in the queue. */
function needsAttention(tone: Tone, value: string): boolean {
  return tone === 'attention' && Number(value.replace(/[^\d.]/g, '')) > 0;
}

function StatCard({
  title,
  value,
  detail,
  icon: Icon,
  to,
  progress,
  chip,
  tone = 'neutral',
}: {
  title: string;
  value: string;
  detail?: string;
  icon: SvgIconComponent;
  to?: string;
  progress?: number;
  chip?: string;
  tone?: Tone;
}) {
  const wants = needsAttention(tone, value);
  // The one accent this card may use: amber when it wants something, otherwise
  // the ordinary primary. Shared by the rail and the hover border so the two
  // can never disagree.
  const accentFor = (theme: Theme) =>
    wants ? theme.palette.warning.main : theme.palette.primary.main;

  // The icon tile is the exception, and only when nothing is waiting. Twelve
  // cards carrying the same pale blue tile made the page read as one object
  // repeated; the tile now takes the card's own hue, which turns a grid into a
  // set of distinguishable things. A card that *is* waiting keeps the amber,
  // so attention never has to compete with decoration.
  const tileFor = (theme: Theme) => (wants ? theme.palette.warning.main : identityHue(title));

  const card = (
    <Card
      sx={(theme) => {
        const accent = accentFor(theme);
        const shadow = CARD_SHADOW[theme.palette.mode];
        return {
          height: '100%',
          position: 'relative',
          overflow: 'hidden',
          boxShadow: shadow.rest,
          transition: 'box-shadow 160ms ease, transform 160ms ease, border-color 160ms ease',
          // Only on cards with work waiting. A rail on every card told the
          // reader nothing; a rail on two out of eight tells them where to look.
          ...(wants && {
            '&::before': {
              content: '""',
              position: 'absolute',
              insetInline: 0,
              top: 0,
              height: 3,
              bgcolor: accent,
            },
          }),
          ...(to && {
            '&:hover': {
              boxShadow: shadow.hover,
              transform: 'translateY(-2px)',
              borderColor: alpha(accent, 0.45),
            },
          }),
          // Someone who has asked their system to stop moving things gets the
          // shadow and nothing else.
          '@media (prefers-reduced-motion: reduce)': {
            transition: 'box-shadow 160ms ease',
            '&:hover': { transform: 'none' },
          },
        };
      }}
    >
      <CardContent sx={{ pt: 2.5 }}>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1.5 }}>
          {/* The icon in a tinted tile rather than loose on the card - it gives
              the block an anchor point at a readable size. */}
          <Box
            sx={(theme) => ({
              width: 36,
              height: 36,
              borderRadius: 2,
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
              color: tileFor(theme),
              bgcolor: alpha(tileFor(theme), theme.palette.mode === 'light' ? 0.12 : 0.2),
            })}
          >
            <Icon fontSize="small" />
          </Box>
          <Typography variant="subtitle2" color="text.secondary" sx={{ minWidth: 0 }}>
            {title}
          </Typography>
        </Stack>

        <Stack direction="row" spacing={1} alignItems="baseline">
          <Typography
            variant="h2"
            component="p"
            sx={{
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: '-0.02em',
              // A zero is an answer, not an event. Half the cards on this page
              // read 0 on a quiet day, and in full-strength ink they shouted
              // as loudly as the numbers that actually wanted attention.
              color: isNothing(value) ? 'text.disabled' : 'text.primary',
            }}
          >
            {value}
          </Typography>
          {chip && <StatusChip status={chip} />}
        </Stack>

        {progress !== undefined && (
          <LinearProgress
            variant="determinate"
            value={Math.max(0, Math.min(100, progress))}
            sx={{ mt: 1.5, height: 6, borderRadius: 3 }}
          />
        )}

        {detail && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {detail}
          </Typography>
        )}

        {to && (
          <Stack
            direction="row"
            spacing={0.5}
            alignItems="center"
            sx={{ mt: 1.5, color: 'primary.main', fontSize: 14, fontWeight: 600 }}
          >
            Open
            <ArrowForwardIcon sx={{ fontSize: 16 }} />
          </Stack>
        )}
      </CardContent>
    </Card>
  );

  // The whole card is the target when there is somewhere to go - a 240px card
  // with one small link in the corner wastes the other 95% of itself.
  return to ? (
    <CardActionArea
      component={RouterLink}
      to={to}
      sx={{ height: '100%', borderRadius: 2, display: 'block' }}
    >
      {card}
    </CardActionArea>
  ) : (
    card
  );
}

export default function DashboardPage() {
  const user = useAppSelector(selectCurrentUser);
  const isSuperAdmin = (user?.roles ?? []).includes('super_admin');
  const fetcher = useCallback(() => reportsApi.dashboard(), []);
  const { data, loading, error, reload } = useApiResource(fetcher);

  // Applying happens here rather than on the Leave page: the button starts a
  // task, and sending someone to another page to press the same button again
  // is a step that does nothing. `applyUsed` latches on the first open so the
  // dialog's three lookups - leave types, balances, holidays - never run on a
  // dashboard visit that does not apply for anything.
  const [applying, setApplying] = useState(false);
  const [applyUsed, setApplyUsed] = useState(false);
  const openApply = () => {
    setApplyUsed(true);
    setApplying(true);
  };

  // Super Admin has no Dashboard section: their module starts at Employees,
  // so landing on "/" - the post-login default - carries straight through
  // rather than showing a page the sidebar no longer offers.
  if (isSuperAdmin) return <Navigate to="/employees" replace />;

  return (
    <>
      <PageHeader
        title={`Welcome, ${user?.first_name || user?.email || 'there'}`}
        subtitle={
          data?.as_of ? `Your overview as of ${formatDate(data.as_of)}` : 'Your portal overview'
        }
        // The three things people actually open the portal to do. They sit on
        // the panel rather than under it because the stat cards below *report*
        // state, while these start work - and a dashboard should offer the
        // work before it offers the reading.
        actions={data?.me ? <QuickActions onApply={openApply} /> : undefined}
      />

      {error && <ErrorAlert error={error} onRetry={reload} />}
      {/* First load gets the page's own shape as a skeleton; a background
          refresh (data already on screen) keeps the quiet bar instead. */}
      {loading && data && <LinearProgress sx={{ mb: 2 }} />}
      {loading && !data && (
        <Stack spacing={3}>
          <Stack direction="row" spacing={1.5}>
            {[130, 130, 120].map((width, index) => (
              <Skeleton key={index} variant="rounded" width={width} height={36} />
            ))}
          </Stack>
          <Box>
            <Skeleton width={90} height={28} sx={{ mb: 1.5 }} />
            <CardGridSkeleton
              cards={4}
              height={170}
              columns={{ xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' }}
            />
          </Box>
          <CardGridSkeleton
            cards={2}
            height={280}
            columns={{ xs: '1fr', md: 'repeat(2, 1fr)' }}
          />
        </Stack>
      )}

      <Stack spacing={3}>
        {data?.me && (
          <Box>
            <BandHeading>My work</BandHeading>
            <Box
              sx={{
                display: 'grid',
                gap: 2,
                gridTemplateColumns: {
                  xs: '1fr',
                  sm: 'repeat(2, 1fr)',
                  lg: 'repeat(4, 1fr)',
                },
              }}
            >
              <StatCard
                title="Leave available"
                value={`${data.me.leave_available} d`}
                detail={`${data.me.leave_used} used, ${data.me.leave_pending} pending of ${data.me.leave_entitled} entitled`}
                icon={EventAvailableIcon}
                to="/leave"
                progress={
                  Number(data.me.leave_entitled) > 0
                    ? (Number(data.me.leave_used) / Number(data.me.leave_entitled)) * 100
                    : 0
                }
              />
              <StatCard
                title="This week"
                value={`${data.me.week_hours} h`}
                chip={data.me.week_status}
                detail="Hours booked on the current timesheet"
                icon={ScheduleIcon}
                to="/timesheets"
                tone="neutral"
              />
              <StatCard
                title="Open leave requests"
                value={String(data.me.open_leave_requests)}
                detail="Awaiting a decision"
                icon={FactCheckIcon}
                // The caller's own requests, which is what the number counts.
                to="/leave/requests"
                tone="attention"
              />
              <StatCard
                title="My projects"
                value={String(data.me.active_projects)}
                detail="Active allocations"
                icon={WorkIcon}
                to="/projects"
              />
            </Box>
          </Box>
        )}

        {data?.approvals && (
          <Box>
            <BandHeading>Waiting on me</BandHeading>
            <Box
              sx={{
                display: 'grid',
                gap: 2,
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
              }}
            >
              <StatCard
                title="Leave to approve"
                value={String(data.approvals.pending_leave)}
                icon={EventAvailableIcon}
                // The queue, not the caller's own balances.
                to="/leave/approvals"
                tone="attention"
                detail="Requests in your queue"
              />
              <StatCard
                title="Timesheets to approve"
                value={String(data.approvals.pending_timesheets)}
                icon={ScheduleIcon}
                to="/timesheets/approvals"
                tone="attention"
                detail="Submitted and awaiting review"
              />
              <StatCard
                title="Team size"
                value={String(data.approvals.team_size)}
                icon={GroupsIcon}
                to="/employees"
                detail="People in your reporting branch"
              />
            </Box>
          </Box>
        )}

        {data?.organization && (
          <Box>
            <BandHeading>Organization</BandHeading>
            <Box
              sx={{
                display: 'grid',
                gap: 2,
                gridTemplateColumns: {
                  xs: '1fr',
                  sm: 'repeat(2, 1fr)',
                  lg: 'repeat(4, 1fr)',
                },
              }}
            >
              <StatCard
                title="Headcount"
                value={String(data.organization.headcount)}
                icon={GroupsIcon}
                to="/employees"
                detail="Active employees"
              />
              <StatCard
                title="Departments"
                value={String(data.organization.departments)}
                icon={ApartmentIcon}
                to="/employees/departments"
              />
              <StatCard
                title="Active projects"
                value={String(data.organization.active_projects)}
                icon={WorkIcon}
                // Filtered to the ones this number counts, not the whole portfolio.
                to="/projects?status=active"
              />
              <StatCard
                title="On leave today"
                value={String(data.organization.on_leave_today)}
                icon={EventAvailableIcon}
                // The roster behind the number. Not the reports page, which
                // counts a different thing over a different period.
                to="/leave/on-leave-today"
              />
            </Box>
          </Box>
        )}

        {data && (
          <Noticeboard birthdays={data.upcoming_birthdays} holidays={data.upcoming_holidays} />
        )}

        {!loading && !data?.me && !data?.approvals && !data?.organization && (
          <Card>
            <CardContent>
              <Typography variant="body2" color="text.secondary">
                Your employee profile has not been set up yet, so there is nothing to show here.
                Ask HR to complete your record.
              </Typography>
            </CardContent>
          </Card>
        )}
      </Stack>

      {applyUsed && (
        <ApplyLeaveDialog
          open={applying}
          onClose={() => setApplying(false)}
          onApplied={() => {
            setApplying(false);
            // The cards behind the dialog counted the old state: leave
            // available drops by the days requested and open requests goes up
            // by one, so the dashboard has to be asked again.
            void reload();
          }}
        />
      )}
    </>
  );
}
