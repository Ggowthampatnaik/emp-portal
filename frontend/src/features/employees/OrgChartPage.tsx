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
 * A wide tree is wider than a screen, so the whole thing scrolls sideways
 * inside its own box and every branch collapses. Collapsed branches say how
 * many people are folded away — an org chart that hides a department without
 * saying so is worse than one that is too wide.
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
import { useCallback, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';

import { EmptyState, ErrorAlert } from '@/components/common/Feedback';
import PageHeader from '@/components/common/PageHeader';
import { useApiResource } from '@/hooks/useApiResource';
import { employeesApi } from '@/services/api/services';
import type { OrgNode } from '@/types/domain';

/** Card width. Fixed so siblings line up and the connectors meet their cards. */
const CARD = 232;
/** Height of the stem below a card and of each child's stub up to the rail. */
const STEM = 22;
/** Depth that is open on arrival: the top and their directs. */
const DEFAULT_OPEN_DEPTH = 1;
/**
 * Everything above the chart box, so it can run to the bottom of the window:
 * the topbar (64), the main area's padding top and bottom (24 each) and the
 * page header (81). Measured, not guessed - the header is one line of title
 * over one of subtitle at every width from md up, where this applies.
 */
const CHART_TOP_OFFSET = 193;

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
}: {
  node: OrgNode;
  open: boolean;
  onToggle: () => void;
  isRoot: boolean;
}) {
  const reports = node.reports.length;
  const branch = countBranch(node) - 1;

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
            component={RouterLink}
            to={`/employees/${node.id}`}
            variant="body2"
            fontWeight={600}
            noWrap
            title={node.full_name}
            sx={{
              display: 'block',
              textDecoration: 'none',
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
          out of the accessibility tree when there is nothing to toggle. */}
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
    </Paper>
  );
}

function Node({
  node,
  depth,
  expandAll,
}: {
  node: OrgNode;
  depth: number;
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

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <PersonCard
        node={node}
        open={open}
        isRoot={depth === 0}
        onToggle={() => setOverride({ open: !open, token: expandAll.token })}
      />

      {showChildren && (
        <>
          {/* Stem down from this card to the rail below. */}
          <Box sx={{ width: '2px', height: STEM, bgcolor: 'divider' }} />

          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
            {children.map((child, index) => (
              <Box
                key={child.id}
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
                    children.length === 1
                      ? undefined
                      : {
                          content: '""',
                          position: 'absolute',
                          top: 0,
                          height: '2px',
                          bgcolor: 'divider',
                          left: index === 0 ? '50%' : 0,
                          right: index === children.length - 1 ? '50%' : 0,
                        },
                }}
              >
                <Node node={child} depth={depth + 1} expandAll={expandAll} />
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

  const roots = data ?? [];
  const total = roots.reduce((sum, node) => sum + countBranch(node), 0);

  return (
    <>
      <PageHeader
        title="Organization chart"
        subtitle={
          data ? `${total} people in your visible reporting tree` : 'Who reports to whom'
        }
        actions={
          roots.length > 0 ? (
            <Stack direction="row" spacing={1} alignItems="center">
              {/* Beside the controls it explains, rather than orphaned under
                  the chart where it read as a stray label. */}
              {roots.length > 1 && (
                <Tooltip title="People whose own manager is outside what you can see appear as separate roots.">
                  <Chip
                    size="small"
                    icon={<GroupsIcon />}
                    variant="outlined"
                    label={`${roots.length} top-level people`}
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
          variant="outlined"
          sx={{
            // A tree is wider than a screen sooner than you would think, so it
            // scrolls inside its own box rather than stretching the page.
            //
            // The box runs to the bottom of the window rather than stopping
            // under the cards. Sized to its content it ended mid-page, which
            // put the horizontal scrollbar in the middle of an otherwise empty
            // screen - it read as a divider, and people missed that there was
            // more chart to the right. Now the bar sits along the bottom edge
            // where a scrollbar belongs, and the space it used to waste is
            // part of the chart.
            //
            // Vertical scrolling comes with that: at a fixed height a fully
            // expanded tree would otherwise be cut off.
            overflowX: 'auto',
            overflowY: 'auto',
            // Only from md up. Narrow screens keep an auto height and let the
            // page scroll, which is the behaviour a phone expects.
            height: { md: `calc(100vh - ${CHART_TOP_OFFSET}px)` },
            p: 3,
            borderRadius: 2,
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
          <Stack direction="row" spacing={6} sx={{ minWidth: 'min-content' }}>
            {roots.map((node) => (
              <Node key={node.id} node={node} depth={0} expandAll={expandAll} />
            ))}
          </Stack>
        </Paper>
      )}
    </>
  );
}
