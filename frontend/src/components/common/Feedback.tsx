/** Small shared pieces for loading, empty and error states. */

import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

import type { ApiError } from '@/types/api';

export function ErrorAlert({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  const fields = Object.entries(error.fieldErrors);
  return (
    <Alert
      severity="error"
      action={
        onRetry ? (
          <Typography
            component="button"
            variant="button"
            onClick={onRetry}
            sx={{ background: 'none', border: 0, cursor: 'pointer', color: 'inherit' }}
          >
            Retry
          </Typography>
        ) : undefined
      }
      sx={{ mb: 2 }}
    >
      <AlertTitle>{error.message}</AlertTitle>
      {fields.length > 0 && (
        <Stack component="ul" sx={{ m: 0, pl: 2 }}>
          {fields.map(([field, message]) => (
            <li key={field}>
              <strong>{field}:</strong> {message}
            </li>
          ))}
        </Stack>
      )}
      {error.requestId !== '-' && (
        <Typography variant="caption" color="inherit">
          Request {error.requestId}
        </Typography>
      )}
    </Alert>
  );
}

export function TableSkeleton({ rows = 5, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <Box sx={{ p: 2 }}>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <Stack key={rowIndex} direction="row" spacing={2} sx={{ mb: 1 }}>
          {Array.from({ length: columns }).map((__, columnIndex) => (
            <Skeleton key={columnIndex} variant="text" sx={{ flex: 1, fontSize: '1.5rem' }} />
          ))}
        </Stack>
      ))}
    </Box>
  );
}

/**
 * A grid of card-shaped placeholders, matching the card grids the data pages
 * render. A skeleton over a bare progress bar because it holds the layout:
 * the page keeps its shape while loading instead of collapsing to a strip
 * and then jumping open. MUI's Skeleton already sits out `prefers-reduced-
 * motion`, so nothing extra is needed for that.
 */
export function CardGridSkeleton({
  cards = 6,
  height = 150,
  columns = { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' },
}: {
  cards?: number;
  height?: number;
  columns?: Record<string, string>;
}) {
  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: columns }}>
      {Array.from({ length: cards }).map((_, index) => (
        <Skeleton key={index} variant="rounded" height={height} sx={{ borderRadius: 2 }} />
      ))}
    </Box>
  );
}

/** Avatar-and-two-lines rows - the shape of a list of people or messages. */
export function ListRowsSkeleton({
  rows = 5,
  avatar = true,
}: {
  rows?: number;
  avatar?: boolean;
}) {
  return (
    <Stack sx={{ p: 2 }} spacing={2}>
      {Array.from({ length: rows }).map((_, index) => (
        <Stack key={index} direction="row" spacing={1.5} alignItems="center">
          {avatar && <Skeleton variant="circular" width={40} height={40} />}
          <Box sx={{ flexGrow: 1 }}>
            <Skeleton width="35%" />
            <Skeleton width="60%" sx={{ fontSize: '0.75rem' }} />
          </Box>
          <Skeleton variant="rounded" width={64} height={22} sx={{ borderRadius: 999 }} />
        </Stack>
      ))}
    </Stack>
  );
}

export function EmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <Stack spacing={1.5} alignItems="center" sx={{ py: 6, px: 2, textAlign: 'center' }}>
      <Typography variant="h4" color="text.secondary">
        {title}
      </Typography>
      {detail && (
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 460 }}>
          {detail}
        </Typography>
      )}
      {action}
    </Stack>
  );
}
