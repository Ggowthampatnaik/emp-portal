/**
 * A dialog title with a close button.
 *
 * Every popup in the portal uses this, so the close control sits in the same
 * place with the same behaviour throughout. It replaces MUI's `DialogTitle`
 * directly — pass the same `onClose` the Cancel button uses, so the two routes
 * out of a dialog can never diverge.
 */

import CloseIcon from '@mui/icons-material/Close';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  onClose: () => void;
  /** Optional line under the title. */
  subtitle?: string;
  /** Disable while a save is in flight, so a half-written record cannot vanish. */
  disabled?: boolean;
}

export default function ClosableDialogTitle({
  children,
  onClose,
  subtitle,
  disabled = false,
}: Props) {
  return (
    <DialogTitle component="div" sx={{ pr: 7 }}>
      <Stack direction="row" alignItems="flex-start">
        <div>
          <Typography variant="h4" component="h2">
            {children}
          </Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {subtitle}
            </Typography>
          )}
        </div>
      </Stack>

      <Tooltip title="Close">
        <span>
          <IconButton
            onClick={onClose}
            disabled={disabled}
            aria-label="Close"
            size="small"
            // Neutral, not red: closing a dialog is not destructive, and
            // error colouring on every popup in the portal made Cancel read
            // as if it would discard something irreversible.
            sx={{
              position: 'absolute',
              right: 12,
              top: 12,
              color: 'text.secondary',
              '&:hover': { backgroundColor: 'action.hover', color: 'text.primary' },
            }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
    </DialogTitle>
  );
}
