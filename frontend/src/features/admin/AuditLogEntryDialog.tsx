/**
 * One audit entry, in full.
 *
 * The table carries only what you scan for - when, who, what action, which
 * record. Everything else lives here: what actually changed, and the IP address
 * and request id that let an entry be traced back through the server logs. That
 * is the point of an audit trail, and none of it fitted in a table cell.
 */

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import ClosableDialogTitle from '@/components/common/ClosableDialogTitle';
import type { AuditLogEntry } from '@/types/domain';
import { formatDateTime } from '@/utils/date';

/** A label above its value, the same shape the profile panels use. */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <Typography variant="body2">{value || '—'}</Typography>
    </Box>
  );
}

/** `["hr", "admin"]` is a before and an after; anything else prints as it is. */
function readable(value: unknown): { before?: string; after: string } {
  const text = (item: unknown) =>
    item === null || item === undefined || item === ''
      ? '—'
      : typeof item === 'object'
        ? JSON.stringify(item)
        : String(item);

  if (Array.isArray(value) && value.length === 2) {
    return { before: text(value[0]), after: text(value[1]) };
  }
  return { after: text(value) };
}

export default function AuditLogEntryDialog({
  entry,
  onClose,
}: {
  entry: AuditLogEntry | null;
  onClose: () => void;
}) {
  const changes = Object.entries(entry?.changes ?? {});

  return (
    <Dialog open={Boolean(entry)} onClose={onClose} fullWidth maxWidth="sm">
      <ClosableDialogTitle onClose={onClose}>Audit entry</ClosableDialogTitle>
      <DialogContent dividers>
        {entry && (
          <Stack spacing={2.5}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip label={entry.action} size="small" />
              <Typography variant="body2" color="text.secondary">
                {formatDateTime(entry.created_at)}
              </Typography>
            </Stack>

            <Box
              sx={{
                display: 'grid',
                gap: 2,
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
              }}
            >
              <Field label="Who" value={entry.actor_name ?? 'System'} />
              <Field label="Their email" value={entry.actor_email} />
              <Field label="Record" value={entry.entity_label || entry.entity_type} />
              <Field label="Record type" value={entry.entity_type} />
              <Field label="Record id" value={entry.entity_id} />
              <Field label="IP address" value={entry.ip_address ?? ''} />
            </Box>

            <Divider />

            <Box>
              <Typography variant="subtitle2" gutterBottom>
                What changed
              </Typography>
              {changes.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  This action recorded no field changes.
                </Typography>
              ) : (
                <Stack divider={<Divider flexItem />}>
                  {changes.map(([key, value]) => {
                    const { before, after } = readable(value);
                    return (
                      <Stack
                        key={key}
                        direction="row"
                        spacing={2}
                        alignItems="baseline"
                        sx={{ py: 1 }}
                      >
                        <Typography
                          variant="body2"
                          sx={{ minWidth: 140, fontWeight: 600, wordBreak: 'break-word' }}
                        >
                          {key}
                        </Typography>
                        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                          {before !== undefined ? (
                            <Stack
                              direction="row"
                              spacing={1}
                              alignItems="baseline"
                              flexWrap="wrap"
                            >
                              <Typography
                                variant="body2"
                                color="text.secondary"
                                sx={{ textDecoration: 'line-through' }}
                              >
                                {before}
                              </Typography>
                              <Typography variant="body2" color="text.secondary">
                                &rarr;
                              </Typography>
                              <Typography variant="body2">{after}</Typography>
                            </Stack>
                          ) : (
                            <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                              {after}
                            </Typography>
                          )}
                        </Box>
                      </Stack>
                    );
                  })}
                </Stack>
              )}
            </Box>

            {/* Last, and monospaced: nobody reads it, but when something has to
                be traced through the server logs it is the only way in. */}
            <Box>
              <Typography variant="caption" color="text.secondary" display="block">
                Request id
              </Typography>
              <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                {entry.request_id || '—'}
              </Typography>
            </Box>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
