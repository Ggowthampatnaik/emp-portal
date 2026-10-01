/**
 * What a route shows when it throws.
 *
 * Without an `errorElement`, React Router falls back to its own developer
 * screen — a wall of red reading "Unexpected Application Error!" over a stack
 * trace. Most of what lands here is not an application error at all: pages are
 * lazy-loaded, so every chunk is fetched on navigation, and any moment the dev
 * server restarts or a deploy replaces the bundle those fetches fail with
 * "Failed to fetch dynamically imported module". The page the user wanted is
 * fine; the copy of the app in their tab is simply out of date.
 *
 * So that case reloads itself once — a fresh document picks up the current
 * chunk names and carries on. The reload is guarded by a `sessionStorage` flag
 * so a genuinely missing chunk cannot put the tab in a refresh loop; the second
 * time through, the message below is shown instead.
 */

import RefreshIcon from '@mui/icons-material/Refresh';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect } from 'react';
import { Link as RouterLink, useRouteError } from 'react-router-dom';

import { OwlMark } from '@/components/common/Logo';

const RELOADED = 'empportal.chunk-reloaded';

/** The browser wording differs; all three mean "that chunk is gone". */
function isStaleChunk(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return /dynamically imported module|Loading chunk|Importing a module script failed|error loading dynamically imported module/i.test(
    message,
  );
}

export default function RouteError() {
  const error = useRouteError();
  const stale = isStaleChunk(error);

  useEffect(() => {
    if (!stale) return;
    let alreadyTried = true;
    try {
      alreadyTried = sessionStorage.getItem(RELOADED) === '1';
      if (!alreadyTried) sessionStorage.setItem(RELOADED, '1');
    } catch {
      // Private browsing can refuse storage. Without somewhere to record the
      // attempt a reload could loop, so do nothing and show the message.
      return;
    }
    if (!alreadyTried) window.location.reload();
  }, [stale]);

  // Cleared on any successful render, so the next stale chunk gets its reload.
  useEffect(() => {
    if (stale) return;
    try {
      sessionStorage.removeItem(RELOADED);
    } catch {
      /* nothing to clear */
    }
  }, [stale]);

  const title = stale ? 'This page needs a refresh' : 'Something went wrong';
  const detail = stale
    ? 'The app was updated while this tab was open, so part of it could not be loaded. Reloading picks up the new version.'
    : 'That page could not be opened. Reloading usually clears it; if it keeps happening, tell IT what you were doing.';

  return (
    <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '60vh', p: 2 }}>
      <Stack spacing={2} alignItems="center" textAlign="center">
        <OwlMark size={56} />
        <Typography variant="h2" component="h1">
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 460 }}>
          {detail}
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            startIcon={<RefreshIcon />}
            onClick={() => window.location.reload()}
          >
            Reload
          </Button>
          <Button component={RouterLink} to="/" variant="text">
            Back to dashboard
          </Button>
        </Stack>
        {import.meta.env.DEV && error instanceof Error && (
          <Typography
            variant="caption"
            color="text.disabled"
            sx={{ fontFamily: 'monospace', maxWidth: 620, wordBreak: 'break-word' }}
          >
            {error.message}
          </Typography>
        )}
      </Stack>
    </Box>
  );
}
