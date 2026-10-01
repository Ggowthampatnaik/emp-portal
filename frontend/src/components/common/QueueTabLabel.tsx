/**
 * A tab label carrying the depth of the queue behind it.
 *
 * The count used to be a Badge hung off the label with `right: -14`, which put
 * it outside the tab's own box: the tab measured narrower than it drew, so the
 * count overlapped the neighbouring tab and the last one was clipped by the
 * edge of the card. Inline, the tab measures its true width and nothing
 * overhangs.
 */

import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';

export default function QueueTabLabel({
  label,
  count,
  color = 'warning',
}: {
  label: string;
  count: number;
  color?: 'warning' | 'info' | 'primary';
}) {
  return (
    <Stack direction="row" spacing={0.75} alignItems="center">
      <span>{label}</span>
      {count > 0 && (
        <Chip
          label={count}
          color={color}
          size="small"
          sx={{
            height: 20,
            minWidth: 20,
            '& .MuiChip-label': { px: 0.75, fontSize: '0.75rem', fontWeight: 700 },
          }}
        />
      )}
    </Stack>
  );
}
