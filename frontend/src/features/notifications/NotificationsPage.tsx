/** Notification centre. */

import DoneAllIcon from '@mui/icons-material/DoneAll';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import List from '@mui/material/List';
import ListSubheader from '@mui/material/ListSubheader';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import TablePagination from '@mui/material/TablePagination';
import Typography from '@mui/material/Typography';
import { Fragment, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAppDispatch } from '@/app/hooks';
import { EmptyState, ErrorAlert, ListRowsSkeleton } from '@/components/common/Feedback';
import PageHeader from '@/components/common/PageHeader';
import { refreshUnreadCount } from '@/features/notifications/notificationsSlice';
import { useApiAction, useApiResource } from '@/hooks/useApiResource';
import { notificationsApi } from '@/services/api/services';
import { addDays, formatDate, formatDateTime, toIsoDate, todayIso } from '@/utils/date';
import type { AppNotification } from '@/types/domain';

const LEVEL_COLOR = {
  info: 'info',
  success: 'success',
  warning: 'warning',
  error: 'error',
} as const;

/** "Today" / "Yesterday" / "12 Aug 2026" for the day a notification arrived. */
function dayLabel(iso: string | undefined): string {
  if (!iso) return '';
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '';
  const day = toIsoDate(when);
  const today = todayIso();
  if (day === today) return 'Today';
  if (day === toIsoDate(addDays(new Date(), -1))) return 'Yesterday';
  return formatDate(day);
}

export default function NotificationsPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [page, setPage] = useState(0);

  const { data, loading, error, reload } = useApiResource(
    useCallback(() => notificationsApi.list({ page: page + 1, page_size: 20 }), [page]),
    [page],
  );

  const markRead = useApiAction(notificationsApi.markRead);
  const markAllRead = useApiAction(notificationsApi.markAllRead);

  const open = async (notification: AppNotification) => {
    if (!notification.is_read) {
      await markRead.run(notification.id);
      void reload();
      void dispatch(refreshUnreadCount());
    }
    if (notification.link) navigate(notification.link);
  };

  const handleMarkAll = async () => {
    await markAllRead.run();
    void reload();
    void dispatch(refreshUnreadCount());
  };

  const unread = (data?.results ?? []).filter((row) => !row.is_read).length;

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle={unread > 0 ? `${unread} unread on this page` : 'You are up to date'}
        actions={
          <Button
            startIcon={<DoneAllIcon />}
            onClick={handleMarkAll}
            disabled={markAllRead.busy || unread === 0}
          >
            Mark all read
          </Button>
        }
      />

      {error && <ErrorAlert error={error} onRetry={reload} />}

      <Card>
        {loading ? (
          <ListRowsSkeleton rows={6} avatar={false} />
        ) : !data?.results.length ? (
          <EmptyState
            title="No notifications"
            detail="Leave and timesheet activity involving you shows up here."
          />
        ) : (
          <List disablePadding>
            {data.results.map((row, index) => (
              <Fragment key={row.id}>
                {/* Day headings: twenty undifferentiated rows is a wall, and
                    "was that today or last week?" is the first thing anyone
                    asks of a notification feed. */}
                {dayLabel(row.created_at) !== dayLabel(data.results[index - 1]?.created_at) && (
                  <ListSubheader
                    disableSticky
                    sx={{
                      bgcolor: 'background.default',
                      lineHeight: '32px',
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                      color: 'text.secondary',
                    }}
                  >
                    {dayLabel(row.created_at)}
                  </ListSubheader>
                )}
                <ListItemButton
                  onClick={() => void open(row)}
                  sx={{
                    borderLeft: 4,
                    borderLeftColor: row.is_read
                      ? 'transparent'
                      : `${LEVEL_COLOR[row.level]}.main`,
                    bgcolor: row.is_read ? undefined : 'action.hover',
                    alignItems: 'flex-start',
                  }}
                >
                  <ListItemText
                    primary={
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography variant="body2" fontWeight={row.is_read ? 400 : 700}>
                          {row.title}
                        </Typography>
                        {!row.is_read && <Chip size="small" color="warning" label="new" />}
                      </Stack>
                    }
                    secondary={
                      <>
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          component="span"
                          display="block"
                        >
                          {row.message}
                        </Typography>
                        <Typography variant="caption" color="text.disabled">
                          {formatDateTime(row.created_at)}
                        </Typography>
                      </>
                    }
                  />
                </ListItemButton>
              </Fragment>
            ))}
          </List>
        )}

        {data && (
          <TablePagination
            component="div"
            count={data.count}
            page={page}
            onPageChange={(_, next) => setPage(next)}
            rowsPerPage={20}
            rowsPerPageOptions={[20]}
          />
        )}
      </Card>
    </>
  );
}
