import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme, type Theme } from '@mui/material/styles';
import { NavLink, useLocation } from 'react-router-dom';

import Logo from '@/components/common/Logo';
import { NAV_ITEMS } from '@/components/layout/navigation';
import { usePermissions } from '@/hooks/usePermissions';
import { BRAND, RAIL } from '@/styles/theme';

export const SIDEBAR_WIDTH = 248;

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function Sidebar({ open, onClose }: Props) {
  const { canAny, isSuperAdmin } = usePermissions();
  const { pathname } = useLocation();
  // Below md the drawer floats over the page and closes behind you; a
  // persistent drawer at 248px leaves a phone barely 140px of content.
  const isMobile = useMediaQuery((theme: Theme) => theme.breakpoints.down('md'));
  const isDark = useTheme().palette.mode === 'dark';

  const visibleItems = NAV_ITEMS.filter(
    (item) =>
      !(isSuperAdmin && item.hiddenForSuperAdmin) &&
      (item.permissions.length === 0 || canAny(...item.permissions)),
  );

  return (
    <Drawer
      variant={isMobile ? 'temporary' : 'persistent'}
      open={open}
      onClose={onClose}
      // Keeps the drawer mounted between opens on a phone, so the first tap
      // is not a re-render of the whole nav.
      ModalProps={{ keepMounted: true }}
      sx={{
        width: isMobile ? 0 : open ? SIDEBAR_WIDTH : 0,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: SIDEBAR_WIDTH,
          boxSizing: 'border-box',
          // The rail is dark in both modes - see RAIL in styles/theme. It is
          // the page's spine, and it keeps navigation out of the content's
          // visual competition.
          backgroundImage: (theme: Theme) =>
            theme.palette.mode === 'light'
              ? `linear-gradient(180deg, ${RAIL.top} 0%, ${RAIL.base} 100%)`
              : `linear-gradient(180deg, ${RAIL.topDark} 0%, ${RAIL.baseDark} 100%)`,
          color: RAIL.ink,
          borderRight: 'none',
        },
      }}
    >
      {/* The logo keeps the surface the topbar has, not the rail's navy, so
          the strip across the top of the window is one continuous band and the
          mark sits on the ground the artwork was drawn for. The inverted
          artwork is still the right one in dark mode, where that surface is
          itself dark. */}
      <Toolbar sx={{ px: 2, bgcolor: 'background.paper' }}>
        {/* The mark is the way home. Every portal trains people to click the
            logo to get back to the start, and this one used to do nothing -
            which is the kind of small dead end that makes software feel
            unfinished. It points at "/", so Super Admin lands on Employees by
            the same redirect that already sends them there at sign-in. */}
        <Box
          component={NavLink}
          to="/"
          aria-label="Trigyan — go to the dashboard"
          sx={{
            display: 'inline-flex',
            borderRadius: 1,
            transition: 'opacity 140ms ease',
            '&:hover': { opacity: 0.82 },
            '&:focus-visible': {
              outline: (theme: Theme) => `2px solid ${theme.palette.primary.main}`,
              outlineOffset: 3,
            },
            '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
          }}
        >
          <Logo size={34} inverted={isDark} />
        </Box>
      </Toolbar>
      <Divider sx={{ borderColor: RAIL.line }} />

      <Box component="nav" aria-label="Main navigation" sx={{ py: 1.5 }}>
        <List>
          {visibleItems.map(({ label, path, icon: Icon }) => {
            const selected = path === '/' ? pathname === '/' : pathname.startsWith(path);
            return (
              <ListItemButton
                key={path}
                component={NavLink}
                to={path}
                selected={selected}
                sx={{
                  mx: 1,
                  mb: 0.5,
                  borderRadius: 2,
                  color: RAIL.ink,
                  '&:hover': { bgcolor: RAIL.tint, color: RAIL.inkStrong },
                  // Light mode: a white pill in the logo's blue with its green
                  // icon. Dark mode keeps a quiet tint - a white patch would be
                  // the brightest thing on a dark screen.
                  position: 'relative',
                  '&.Mui-selected': {
                    bgcolor: isDark ? RAIL.tint : RAIL.selected,
                    color: isDark ? RAIL.inkStrong : RAIL.selectedInk,
                    '& .MuiListItemIcon-root': {
                      color: isDark ? BRAND.green : BRAND.greenDark,
                    },
                    '& .MuiListItemText-primary': { fontWeight: 700 },
                    // A bar on the leading edge, which is the cue people read
                    // before they read the tint - and the one that still works
                    // for anyone who cannot see the tint at all.
                    '&::before': {
                      content: '""',
                      position: 'absolute',
                      insetBlock: 6,
                      left: 0,
                      width: 3,
                      borderRadius: 3,
                      bgcolor: BRAND.green,
                    },
                  },
                  '&.Mui-selected:hover': {
                    bgcolor: isDark ? RAIL.tint : 'rgba(255,255,255,0.92)',
                  },
                }}
              >
                <ListItemIcon sx={{ color: 'inherit', minWidth: 40 }}>
                  <Icon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary={label} />
              </ListItemButton>
            );
          })}
        </List>

        {/* Super Admin's menu is deliberately the oversight view alone, but a
            sidebar holding one item above a large blank reads as a menu that
            failed to load. Saying so costs a line and removes the doubt. */}
        {isSuperAdmin && (
          <Typography
            variant="caption"
            sx={{ display: 'block', px: 3, pt: 1, color: 'rgba(255,255,255,0.82)' }}
          >
            Super Admin sees the company directory only — the operational modules belong to the
            roles that run them.
          </Typography>
        )}
      </Box>

      <Box sx={{ mt: 'auto', p: 2 }}>
        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.72)' }}>
          Trigyan · Empowering Ideas
        </Typography>
      </Box>
    </Drawer>
  );
}
