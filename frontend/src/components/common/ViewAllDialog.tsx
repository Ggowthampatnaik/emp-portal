/**
 * The full list behind a profile card's "View more".
 *
 * A profile card shows one entry so the cards beside it stay the same size;
 * everything else lives here. The dialog renders the same rows the card does,
 * so the two can never drift apart in wording or layout.
 */

import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import type { ReactNode } from 'react';

import ClosableDialogTitle from '@/components/common/ClosableDialogTitle';

export default function ViewAllDialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" scroll="paper">
      <ClosableDialogTitle onClose={onClose}>{title}</ClosableDialogTitle>
      <DialogContent dividers>{children}</DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
