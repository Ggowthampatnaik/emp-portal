import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Snackbar from '@mui/material/Snackbar';
import Toolbar from '@mui/material/Toolbar';
import useMediaQuery from '@mui/material/useMediaQuery';
import type { Theme } from '@mui/material/styles';
import { Suspense, useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useAppDispatch, useAppSelector } from '@/app/hooks';
import LoadingScreen from '@/components/common/LoadingScreen';
import Sidebar, { SIDEBAR_WIDTH } from '@/components/layout/Sidebar';
import { ambientBackground } from '@/styles/theme';
import Topbar from '@/components/layout/Topbar';
import { selectCurrentUser } from '@/features/auth/authSlice';
import { refreshUnreadCount } from '@/features/notifications/notificationsSlice';
import {
  dismissToast,
  selectSidebarOpen,
  selectToasts,
  setSidebarOpen,
  toggleSidebar,
} from '@/features/ui/uiSlice';

/** How often the unread badge re-checks. Cheap query, no websocket needed. */
const UNREAD_POLL_MS = 60_000;

/** Shell for every authenticated page: sidebar, topbar, content, toasts. */
export default function AppLayout() {
  const dispatch = useAppDispatch();
  const location = useLocation();
  const sidebarOpen = useAppSelector(selectSidebarOpen);
  const toasts = useAppSelector(selectToasts);
  const user = useAppSelector(selectCurrentUser);
  const current = toasts[0];
  const isMobile = useMediaQuery((theme: Theme) => theme.breakpoints.down('md'));

  useEffect(() => {
    void dispatch(refreshUnreadCount());
    const timer = window.setInterval(() => {
      void dispatch(refreshUnreadCount());
    }, UNREAD_POLL_MS);
    return () => window.clearInterval(timer);
  }, [dispatch]);

  // On a phone the drawer covers the page, so leaving it open after a tap
  // would hide the page it just opened. Desktop keeps its drawer pinned.
  useEffect(() => {
    if (isMobile) dispatch(setSidebarOpen(false));
  }, [isMobile, location.pathname, dispatch]);

  // A temporary password must be replaced before the portal can be used.
  if (user?.must_change_password && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }

  // ...and then the profile has to be filled in (F18). The server enforces the
  // same rule on every endpoint, so this redirect is a courtesy rather than the
  // control - typing a URL gets a 403, not a page.
  if (
    user &&
    !user.profile_completed &&
    !user.must_change_password &&
    location.pathname !== '/complete-profile'
  ) {
    return <Navigate to="/complete-profile" replace />;
  }

  // Mid-onboarding there is no portal to show a menu for: the sidebar would
  // just be a list of doors the server refuses. Bare pages until the profile
  // is submitted; the chrome appears with the access it describes.
  if (user && (user.must_change_password || !user.profile_completed)) {
    return (
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
        <Suspense fallback={<LoadingScreen />}>
          <Outlet />
        </Suspense>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        minHeight: '100vh',
        bgcolor: 'background.default',
        // The ambient wash sits on the shell, so it spans sidebar and content
        // and every page inherits it without knowing about it.
        backgroundImage: (theme) => ambientBackground(theme.palette.mode),
        backgroundRepeat: 'no-repeat',
      }}
    >
      <Topbar onToggleSidebar={() => dispatch(toggleSidebar())} />
      <Sidebar open={sidebarOpen} onClose={() => dispatch(toggleSidebar())} />

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: { xs: 2, md: 3 },
          width: { md: `calc(100% - ${sidebarOpen ? SIDEBAR_WIDTH : 0}px)` },
          transition: 'width 200ms ease',
          minWidth: 0,
        }}
      >
        <Toolbar />
        <Suspense fallback={<LoadingScreen />}>
          <Outlet />
        </Suspense>
      </Box>

      <Snackbar
        open={Boolean(current)}
        autoHideDuration={5000}
        onClose={() => current && dispatch(dismissToast(current.id))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        {current ? (
          <Alert
            severity={current.severity}
            onClose={() => dispatch(dismissToast(current.id))}
            variant="filled"
          >
            {current.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  );
}
