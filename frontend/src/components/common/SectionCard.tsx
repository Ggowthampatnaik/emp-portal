/**
 * One panel of a dashboard or a profile.
 *
 * Every card in those two places was hand-rolled: the same header shape written
 * six times with `mb: 1` here and `my: 2` there, and each card sized to its own
 * content. Side by side that reads as misalignment — headings at different
 * heights, rules at different offsets, bottoms that never line up.
 *
 * So the rhythm lives here instead. Two properties make it work:
 *
 * - the card fills its grid cell (`height: 100%`), so a row of them is one
 *   height rather than as many heights as there are cards;
 * - the body grows and the footer is pushed to the bottom, so "View more" sits
 *   on the same line in every card whatever the list above it is doing.
 *
 * The grid must not set `alignItems: 'start'`, which sizes each cell to its
 * content and quietly defeats the first of those.
 */

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import type { ReactNode } from 'react';

interface Props {
  title: string;
  /** Sits left of the title. Same size in every card, so titles line up. */
  icon?: ReactNode;
  /** One line under the title. */
  subtitle?: string;
  /** A count chip beside the title; hidden at zero, which needs no chip. */
  count?: number;
  /** Top-right control — Edit, Add, a status chip. */
  action?: ReactNode;
  /** Rendered above the title — the profile photo is the only user of this. */
  header?: ReactNode;
  /** Pinned to the bottom of the card, so footers align across a row. */
  footer?: ReactNode;
  children: ReactNode;
  /** For the rare card that needs its own frame, e.g. a warning border. */
  sx?: SxProps<Theme>;
}

export default function SectionCard({
  title,
  icon,
  subtitle,
  count,
  action,
  header,
  footer,
  children,
  sx,
}: Props) {
  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', ...sx }}>
      <CardContent
        sx={{
          p: 3,
          flexGrow: 1,
          display: 'flex',
          flexDirection: 'column',
          // MUI drops 24px of extra padding on the last child; the explicit
          // value keeps the bottom inset equal to the other three.
          '&:last-child': { pb: 3 },
        }}
      >
        {header && <Box sx={{ mb: 3 }}>{header}</Box>}

        <Stack direction="row" spacing={1.5} alignItems="center">
          {icon}
          <Typography variant="h4" component="h2" sx={{ flexGrow: 1, minWidth: 0 }}>
            {title}
          </Typography>
          {count !== undefined && count > 0 && <Chip size="small" label={count} />}
          {action}
        </Stack>

        {subtitle && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {subtitle}
          </Typography>
        )}

        <Divider sx={{ my: 2 }} />

        <Stack sx={{ flexGrow: 1 }}>{children}</Stack>

        {footer && (
          <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2 }}>
            {footer}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
