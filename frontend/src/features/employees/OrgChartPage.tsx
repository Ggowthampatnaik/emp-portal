/**
 * The reporting tree, drawn the way Microsoft Teams draws one: a manager card
 * with their reports in a row beneath, joined by elbow connectors, read
 * top-down rather than as an indented list.
 *
 * The connectors are CSS, not a canvas or a layout library. Each row of
 * children carries a horizontal rail and each child a short vertical stub up to
 * it; the first and last children get half a rail so the line stops at the
 * outermost card instead of hanging past it. That is the whole trick, and it
 * costs nothing at any depth.
 *
 * Side by side, the people at the bottom of a tree made it several screens
 * wide, so anyone with no reports of their own is stacked in a column under
 * their manager, on a rail down the left. What is still too wide scrolls
 * sideways inside its own box, kept centred on the top of the tree, and every
 * branch collapses. Collapsed branches say how many people are folded away — an
 * org chart that hides a department without saying so is worse than one that is
 * too wide.
 *
 * People with no manager and nobody under them are not the top of anything, so
 * they are left off rather than drawn beside the real top of it. Given a
 * manager, they appear under them.
 */

import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import GroupsIcon from '@mui/icons-material/Groups';
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { EmptyState, ErrorAlert } from '@/components/common/Feedback';
import PageHeader from '@/components/common/PageHeader';
import EmployeeDetailsDialog from '@/features/employees/EmployeeDetailsDialog';
import { useApiResource } from '@/hooks/useApiResource';
import { employeesApi } from '@/services/api/services';
import type { OrgNode } from '@/types/domain';

/** Card width. Fixed so siblings line up and the connectors meet their cards. */
const CARD = 232;
/** Height of the stem below a card and of each child's stub up to the rail. */
const STEM = 22;
/** Room for the rail down the left of a stacked column of reports. */
const STACK_RAIL = 20;
/** Depth that is open on arrival: the top and their directs. */
const DEFAULT_OPEN_DEPTH = 1;
/**
 * Space under the chart box: the main area's bottom padding. The box's top is
 * measured rather than added up, because what sits above it - the header, and
 * whether it wraps - changes with the page and the window.
 */
const CHART_BOTTOM_GAP = 24;
/** Where the box starts before it has been measured: topbar, padding, header. */
const CHART_TOP_GUESS = 193;

/**
 * Opens someone's details over the chart. A name used to link to their full
 * record, which only managers and above may open, so everyone else got a 403;
 * the directory's details pop-up is open to every signed-in user and offers the
 * full record itself to those allowed it. Context rather than a prop threaded
 * through every level of the tree.
 */
const OpenPerson = createContext<(id: number) => void>(() => {});

function countBranch(node: OrgNode): number {
  return node.reports.reduce((total, child) => total + countBranch(child), 1);
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function PersonCard({
  node,
  open,
  onToggle,
  isRoot,
  stacked = false,
}: {
  node: OrgNode;
  open: boolean;
  onToggle: () => void;
  isRoot: boolean;
  /** In a column of people with no reports, where no row needs reserving. */
  stacked?: boolean;
}) {
  const reports = node.reports.length;
  const branch = countBranch(node) - 1;
  const openPerson = useContext(OpenPerson);

  return (
    <Paper
      variant="outlined"
      sx={{
        width: CARD,
        p: 1.5,
        borderRadius: 2,
        // The top of the tree carries the accent, so the eye starts there.
        borderTop: 3,
        borderTopColor: isRoot ? 'primary.main' : 'transparent',
        transition: 'box-shadow 120ms, border-color 120ms',
        '&:hover': { boxShadow: 3, borderColor: 'primary.light' },
      }}
    >
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Avatar
          src={node.photo_url ?? undefined}
          alt=""
          sx={{ width: 44, height: 44, flexShrink: 0, fontSize: 15, fontWeight: 700 }}
        >
          {initials(node.full_name)}
        </Avatar>

        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <Typography
            component="button"
            type="button"
            onClick={() => openPerson(node.id)}
            variant="body2"
            fontWeight={600}
            noWrap
            title={node.full_name}
            sx={{
              display: 'block',
              maxWidth: '100%',
              p: 0,
              border: 0,
              bgcolor: 'transparent',
              font: 'inherit',
              fontWeight: 600,
              textAlign: 'left',
              cursor: 'pointer',
              color: 'text.primary',
              '&:hover': { textDecoration: 'underline' },
            }}
          >
            {node.full_name}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap display="block">
            {node.designation ?? node.employee_code}
          </Typography>
          {/* Held open the same way as the toggle below: somebody with no
              department on their record would otherwise make a card a line
              shorter than the ones beside it. */}
          <Typography
            variant="caption"
            color="text.disabled"
            noWrap
            display="block"
            aria-hidden={!node.department}
            sx={node.department ? undefined : { visibility: 'hidden' }}
          >
            {node.department || 'No department'}
          </Typography>
        </Box>
      </Stack>

      {/* Always rendered, even for someone with nobody under them: a leaf card
          beside a manager's used to be a row shorter, so a line of siblings
          came out ragged. Hidden rather than omitted, so the space it reserves
          is exactly a button's and cannot drift from the real one. Inert and
          out of the accessibility tree when there is nothing to toggle. A
          stacked column has no neighbour to line up with, so it drops the row. */}
      {!stacked && (
        <Button
          size="small"
          fullWidth
          onClick={reports > 0 ? onToggle : undefined}
          tabIndex={reports > 0 ? undefined : -1}
          aria-hidden={reports === 0}
          startIcon={open && reports > 0 ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          sx={{
            mt: 1,
            justifyContent: 'center',
            textTransform: 'none',
            ...(reports === 0 && { visibility: 'hidden', pointerEvents: 'none' }),
          }}
        >
          {reports === 0
            ? 'No reports'
            : open
              ? 'Hide reports'
              : `${reports} report${reports === 1 ? '' : 's'}${branch > reports ? ` · ${branch} in branch` : ''}`}
        </Button>
      )}
    </Paper>
  );
}

/** People with no reports of their own, in a column on a rail down the left. */
function StackedReports({
  people,
  depth,
  expandAll,
}: {
  people: OrgNode[];
  depth: number;
  expandAll: { open: boolean; token: number };
}) {
  return (
    <Box
      sx={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        // From under the stub above across to the rail on the left.
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          width: '50%',
          height: '2px',
          bgcolor: 'divider',
        },
      }}
    >
      {people.map((person, index) => (
        <Box
          key={person.id}
          sx={{
            position: 'relative',
            pl: `${STACK_RAIL}px`,
            py: 0.5,
            // The rail, stopping level with the last person.
            '&::before': {
              content: '""',
              position: 'absolute',
              top: 0,
              left: 0,
              width: '2px',
              height: index === people.length - 1 ? '50%' : '100%',
              bgcolor: 'divider',
            },
            // The stub from the rail across to this card.
            '&::after': {
              content: '""',
              position: 'absolute',
              top: '50%',
              left: 0,
              width: `${STACK_RAIL}px`,
              height: '2px',
              bgcolor: 'divider',
            },
          }}
        >
          <Node node={person} depth={depth} expandAll={expandAll} stacked />
        </Box>
      ))}
    </Box>
  );
}

function Node({
  node,
  depth,
  expandAll,
  stacked = false,
}: {
  node: OrgNode;
  depth: number;
  stacked?: boolean;
  /** Bumped by the toolbar; its parity decides open or shut on a reset. */
  expandAll: { open: boolean; token: number };
}) {
  const [override, setOverride] = useState<{ open: boolean; token: number } | null>(null);
  // A per-node toggle wins until the toolbar speaks again, which is what makes
  // "expand all" feel like a command rather than a suggestion.
  const open =
    override && override.token === expandAll.token
      ? override.open
      : expandAll.token > 0
        ? expandAll.open
        : depth < DEFAULT_OPEN_DEPTH;

  const children = node.reports;
  const showChildren = open && children.length > 0;
  // Two or more people with nobody under them share one column, beside any
  // colleagues who do have teams. Side by side they made the tree screens wide.
  const leaves = children.filter((child) => child.reports.length === 0);
  const branches = children.filter((child) => child.reports.length > 0);
  const slots: (OrgNode | OrgNode[])[] = leaves.length > 1 ? [...branches, leaves] : children;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <PersonCard
        node={node}
        open={open}
        isRoot={depth === 0}
        stacked={stacked}
        onToggle={() => setOverride({ open: !open, token: expandAll.token })}
      />

      {showChildren && (
        <>
          {/* Stem down from this card to the rail below. */}
          <Box sx={{ width: '2px', height: STEM, bgcolor: 'divider' }} />

          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
            {slots.map((slot, index) => (
              <Box
                key={Array.isArray(slot) ? 'stack' : slot.id}
                sx={{
                  position: 'relative',
                  px: 1,
                  pt: `${STEM}px`,
                  // The stub up from this child to the rail.
                  '&::before': {
                    content: '""',
                    position: 'absolute',
                    top: 0,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: '2px',
                    height: `${STEM}px`,
                    bgcolor: 'divider',
                  },
                  // The rail itself. An only child needs none — the stem above
                  // already reaches it. The outermost children get half a rail
                  // so it stops at their centre rather than hanging past them.
                  '&::after':
                    slots.length === 1
                      ? undefined
                      : {
                          content: '""',
                          position: 'absolute',
                          top: 0,
                          height: '2px',
                          bgcolor: 'divider',
                          left: index === 0 ? '50%' : 0,
                          right: index === slots.length - 1 ? '50%' : 0,
                        },
                }}
              >
                {Array.isArray(slot) ? (
                  <StackedReports people={slot} depth={depth + 1} expandAll={expandAll} />
                ) : (
                  <Node node={slot} depth={depth + 1} expandAll={expandAll} />
                )}
              </Box>
            ))}
          </Box>
        </>
      )}
    </Box>
  );
}

export default function OrgChartPage() {
  const { data, loading, error, reload } = useApiResource(
    useCallback(() => employeesApi.orgChart(), []),
    [],
  );
  const [expandAll, setExpandAll] = useState({ open: false, token: 0 });
  const [viewing, setViewing] = useState<number | null>(null);

  const roots = data ?? [];
  // Somebody with no manager and no reports is a gap in the data, not the top
  // of a tree. If that is everyone, they are all the chart there is.
  const heads = roots.filter((node) => node.reports.length > 0);
  const tree = heads.length > 0 ? heads : roots;
  // Who is on the chart, which is not quite everyone in the company.
  const total = tree.reduce((sum, node) => sum + countBranch(node), 0);

  // The top of the tree is the middle of it, so that is where the view goes:
  // left where it was, a fully expanded chart opened on an empty stretch of the
  // box with everybody off to the right. A branch toggled by hand stays put.
  const scroller = useRef<HTMLDivElement>(null);

  // How far down the page the chart box starts, so it can reach exactly to the
  // bottom of the window: a fixed guess left it a little too tall, and the page
  // scrolled for nothing.
  const frame = useRef<HTMLDivElement>(null);
  const [chartTop, setChartTop] = useState(CHART_TOP_GUESS);
  useLayoutEffect(() => {
    const measure = () => {
      if (frame.current) {
        setChartTop(Math.round(frame.current.getBoundingClientRect().top + window.scrollY));
      }
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [data]);
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    box.scrollLeft = (box.scrollWidth - box.clientWidth) / 2;
    box.scrollTop = 0;
  }, [data, expandAll.token]);

  return (
    <>
      <PageHeader
        title="Organization chart"
        subtitle={
          data
            ? `${total} ${total === 1 ? 'person' : 'people'} in the company`
            : 'Who reports to whom'
        }
        actions={
          roots.length > 0 ? (
            <Stack direction="row" spacing={1} alignItems="center">
              {/* Beside the controls it explains, rather than orphaned under
                  the chart where it read as a stray label. */}
              {tree.length > 1 && (
                <Tooltip title="People with no manager set appear at the top of their own tree.">
                  <Chip
                    size="small"
                    icon={<GroupsIcon />}
                    variant="outlined"
                    label={`${tree.length} top-level people`}
                    sx={{ color: 'inherit', '& .MuiChip-icon': { color: 'inherit' } }}
                  />
                </Tooltip>
              )}
              <Button
                size="small"
                startIcon={<UnfoldMoreIcon />}
                onClick={() => setExpandAll(({ token }) => ({ open: true, token: token + 1 }))}
              >
                Expand all
              </Button>
              <Button
                size="small"
                startIcon={<UnfoldLessIcon />}
                onClick={() => setExpandAll(({ token }) => ({ open: false, token: token + 1 }))}
              >
                Collapse all
              </Button>
            </Stack>
          ) : undefined
        }
      />

      {error && <ErrorAlert error={error} onRetry={reload} />}
      {loading && <LinearProgress />}

      {!loading && roots.length === 0 && !error && (
        <EmptyState
          title="Nothing to chart yet"
          detail="Reporting managers have not been assigned for the employees you can see."
        />
      )}

      {roots.length > 0 && (
        <Paper
          ref={frame}
          variant="outlined"
          sx={{
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            // At least down to the bottom of the window, and taller when the
            // tree is, so the page scrolls rather than the box. Only from md up;
            // narrow screens keep an auto height, as a phone expects.
            minHeight: { md: `calc(100vh - ${chartTop + CHART_BOTTOM_GAP}px)` },
            borderRadius: 2,
          }}
        >
          <Box
            ref={scroller}
            sx={{
              // A tree is wider than a screen sooner than you would think, so it
              // scrolls inside its own box rather than stretching the page.
              //
              // The box runs at least to the bottom of the window rather than
              // stopping under the cards. Sized to its content it ended
              // mid-page, which put the horizontal scrollbar in the middle of an
              // otherwise empty screen - it read as a divider, and people missed
              // that there was more chart to the right.
              //
              // It never scrolls up and down: a second vertical scrollbar beside
              // the page's own was one too many. A taller tree makes the box,
              // and so the page, taller instead.
              flexGrow: 1,
              overflowX: 'auto',
              overflowY: 'hidden',
              p: 3,
              bgcolor: 'background.default',
              // Scrolling alone is not enough: a card sliced by the right edge
              // reads as a broken layout, not as "there is more this way". The
              // fade is painted by the scroll container itself, so it appears
              // only while there is something still to scroll to and disappears
              // at the end of the run.
              backgroundImage: (theme) => `linear-gradient(
                  to right,
                  ${theme.palette.background.default} 30%,
                  transparent
                ),
                linear-gradient(to left, ${theme.palette.background.default} 30%, transparent),
                linear-gradient(to right, ${theme.palette.divider}, transparent),
                linear-gradient(to left, ${theme.palette.divider}, transparent)`,
              backgroundPosition: 'left center, right center, left center, right center',
              backgroundRepeat: 'no-repeat',
              backgroundSize: '48px 100%, 48px 100%, 14px 100%, 14px 100%',
              backgroundAttachment: 'local, local, scroll, scroll',
            }}
          >
            {/* At least the box's width so a small tree sits in the middle of
                it; as wide as it needs so a big one still scrolls. */}
            <Stack
              direction="row"
              spacing={6}
              justifyContent="center"
              sx={{ width: 'max-content', minWidth: '100%' }}
            >
              <OpenPerson.Provider value={setViewing}>
                {tree.map((node) => (
                  <Node key={node.id} node={node} depth={0} expandAll={expandAll} />
                ))}
              </OpenPerson.Provider>
            </Stack>
          </Box>
        </Paper>
      )}

      <EmployeeDetailsDialog
        employeeId={viewing}
        onClose={() => setViewing(null)}
        onNavigate={setViewing}
      />
    </>
  );
}
