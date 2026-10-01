/**
 * The shared frame every report chart sits in.
 *
 * `components/charts/` existed as an empty directory and `recharts` shipped in
 * package.json unused, so "Reports & analytics" was four tables and no
 * analytics. These are the pieces the charts share: a titled block, a fixed
 * height so a tab does not jump as data loads, and the theme-derived colours
 * recharts needs handed to it explicitly (it cannot read MUI's palette).
 */

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { ReactElement } from 'react';

interface Props {
  title: string;
  /** What the reader is looking at, when the title alone is ambiguous. */
  caption?: string;
  height?: number;
  children: ReactElement;
}

export default function ChartFrame({ title, caption, height = 260, children }: Props) {
  return (
    <Box sx={{ px: 2, pt: 2, pb: 1 }}>
      <Typography variant="subtitle2">{title}</Typography>
      {caption && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          {caption}
        </Typography>
      )}
      {/* The chart is decorative next to the table below it, which carries the
          same numbers accessibly. Fixed height keeps ResponsiveContainer from
          collapsing to zero inside a flex parent. */}
      <Box sx={{ height, width: '100%' }} aria-hidden>
        {children}
      </Box>
    </Box>
  );
}
