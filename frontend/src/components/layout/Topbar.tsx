import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import MenuIcon from '@mui/icons-material/Menu';
import NotificationsIcon from '@mui/icons-material/Notifications';
import AppBar from '@mui/material/AppBar';
import Avatar from '@mui/material/Avatar';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { OwlMark } from '@/components/common/Logo';
import { SIDEBAR_WIDTH } from '@/components/layout/Sidebar';
import { ROLE_LABELS } from '@/types/auth';
import { selectSidebarOpen } from '@/features/ui/uiSlice';
import { selectCurrentUser, signOut } from '@/features/auth/authSlice';
import { selectUnreadCount } from '@/features/notifications/notificationsSlice';
import { selectColorMode, toggleColorMode } from '@/features/ui/uiSlice';

interface Props {
  onToggleSidebar: () => void;
}

export default function Topbar({ onToggleSidebar }: Props) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const user = useAppSelector(selectCurrentUser);
  const colorMode = useAppSelector(selectColorMode);
  const unreadCount = useAppSelector(selectUnreadCount);
  const sidebarOpen = useAppSelector(selectSidebarOpen);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const primaryRole = user?.roles.find((role) => role !== 'employee') ?? user?.roles[0];

  const handleSignOut = async () => {
    setAnchor(null);
    await dispatch(signOut());
    navigate('/login', { replace: true });
  };

  return (
    <AppBar
      position="fixed"
      color="inherit"
      elevation={0}
      sx={{
        borderBottom: 1,
        borderColor: 'divider',
        // A fixed bar is taken out of the flex row, so it does not know the
        // sidebar is there and spans the whole window - with the drawer drawn
        // on top of its first 248px, hiding the menu button and the start of
        // the title. It has to be told to start where the sidebar ends.
        //
        // Only from md up. Below that the drawer floats over the page instead
        // of displacing it, so an offset here would push the bar off-screen -
        // which is exactly what it used to do on a phone.
        width: { xs: '100%', md: sidebarOpen ? `calc(100% - ${SIDEBAR_WIDTH}px)` : '100%' },
        ml: { xs: 0, md: sidebarOpen ? `${SIDEBAR_WIDTH}px` : 0 },
        // Matches the main content's transition, so the two edges move together.
        transition: 'width 200ms ease, margin-left 200ms ease',
      }}
    >
      <Toolbar>
        <IconButton
          edge="start"
          onClick={onToggleSidebar}
          aria-label="Toggle navigation"
          sx={{ mr: 1 }}
        >
          <MenuIcon />
        </IconButton>

        {/* With the sidebar hidden the brand would disappear, so the mark
            steps in beside the title. */}
        {!sidebarOpen && (
          <Box sx={{ mr: 1.5, display: 'flex' }}>
            <OwlMark size={26} />
          </Box>
        )}
        <Typography variant="h4" component="div" sx={{ flexGrow: 1 }} noWrap>
          Employee Management Portal
        </Typography>

        <Tooltip title={colorMode === 'light' ? 'Dark mode' : 'Light mode'}>
          <IconButton
            onClick={() => dispatch(toggleColorMode())}
            aria-label="Toggle colour mode"
          >
            {colorMode === 'light' ? <DarkModeIcon /> : <LightModeIcon />}
          </IconButton>
        </Tooltip>

        <Tooltip title="Notifications">
          <IconButton onClick={() => navigate('/notifications')} aria-label="Notifications">
            <Badge badgeContent={unreadCount} color="error">
              <NotificationsIcon />
            </Badge>
          </IconButton>
        </Tooltip>

        {primaryRole && (
          <Chip
            size="small"
            label={ROLE_LABELS[primaryRole] ?? primaryRole}
            color="secondary"
            sx={{ ml: 1, display: { xs: 'none', sm: 'inline-flex' } }}
          />
        )}

        <Box sx={{ ml: 1 }}>
          <IconButton
            onClick={(event) => setAnchor(event.currentTarget)}
            aria-label="Account menu"
          >
            <Avatar
              src={user?.photo_url ?? undefined}
              alt={user?.full_name ?? 'Account'}
              sx={{ width: 34, height: 34, bgcolor: 'primary.main', fontSize: 14 }}
            >
              {(user?.first_name?.[0] ?? user?.email?.[0] ?? '?').toUpperCase()}
            </Avatar>
          </IconButton>
          <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
            <MenuItem disabled sx={{ opacity: '1 !important' }}>
              <Avatar
                src={user?.photo_url ?? undefined}
                alt={user?.full_name ?? 'Account'}
                sx={{ width: 32, height: 32, mr: 1.5, bgcolor: 'primary.main', fontSize: 13 }}
              >
                {(user?.first_name?.[0] ?? '?').toUpperCase()}
              </Avatar>
              <ListItemText primary={user?.full_name} secondary={user?.email} />
            </MenuItem>
            <Divider />
            <MenuItem
              onClick={() => {
                setAnchor(null);
                navigate('/profile');
              }}
            >
              My profile
            </MenuItem>
            <MenuItem
              onClick={() => {
                setAnchor(null);
                navigate('/change-password');
              }}
            >
              Change password
            </MenuItem>
            <MenuItem onClick={handleSignOut}>Sign out</MenuItem>
          </Menu>
        </Box>
      </Toolbar>
    </AppBar>
  );
}
