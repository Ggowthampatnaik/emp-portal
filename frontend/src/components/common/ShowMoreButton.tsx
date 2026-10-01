/**
 * The "View N more" control in a profile card's footer.
 *
 * One component so every card says it the same way and the buttons land on the
 * same line - `SectionCard` pins the footer to the bottom, and this keeps the
 * wording and size identical inside it. It opens the card's dialog rather than
 * expanding in place: a card that grows changes the height of the card beside
 * it, which is the thing the one-row cap exists to prevent.
 */

import Button from '@mui/material/Button';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';

export default function ShowMoreButton({
  hidden,
  onClick,
  /** What the hidden rows are, for a label somebody can read aloud. */
  noun,
}: {
  hidden: number;
  onClick: () => void;
  noun: string;
}) {
  // Nothing behind it means no button: a card showing everything it has should
  // not offer to show you more.
  if (hidden <= 0) return null;

  return (
    <Button
      size="small"
      onClick={onClick}
      startIcon={<OpenInFullIcon />}
      sx={{ textTransform: 'none' }}
      aria-label={`View all ${noun}`}
    >
      View {hidden} more
    </Button>
  );
}
