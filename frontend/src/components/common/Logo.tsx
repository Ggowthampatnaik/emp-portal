/**
 * Trigyan brand mark — the official artwork.
 *
 * Two assets, each with a white counterpart for use on a coloured surface: the
 * full wordmark ("Tri" + the owl standing in for the "g" + "yan"), and the owl
 * on its own for the places too tight for the word.
 *
 * The owl was cut out of the wordmark by connected-component labelling rather
 * than by eye, which is why it carries no crumbs of the neighbouring letters.
 * Both files are trimmed to the ink, so `size` is the height actually drawn —
 * there is no invisible padding to reason about when lining the logo up with
 * anything else.
 */

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import markUrl from '@/assets/trigyan-mark.png';
import markWhiteUrl from '@/assets/trigyan-mark-white.png';
import wordmarkUrl from '@/assets/trigyan-logo.png';
import wordmarkWhiteUrl from '@/assets/trigyan-logo-white.png';
import { BRAND } from '@/styles/theme';

interface Props {
  /** Rendered height in pixels. The width follows the artwork's proportions. */
  size?: number;
  /** 'full' = wordmark + owl, 'mark' = owl only (favicons, tight spaces). */
  variant?: 'full' | 'mark';
  /** Render light-on-dark, for use on a coloured surface. */
  inverted?: boolean;
}

/** The owl alone. */
export function OwlMark({
  size = 40,
  inverted = false,
}: {
  size?: number;
  inverted?: boolean;
}) {
  return (
    <Box
      component="img"
      src={inverted ? markWhiteUrl : markUrl}
      alt="Trigyan"
      sx={{ height: size, width: 'auto', display: 'block' }}
    />
  );
}

export default function Logo({ size = 32, variant = 'full', inverted = false }: Props) {
  if (variant === 'mark') return <OwlMark size={size} inverted={inverted} />;

  return (
    <Box
      component="img"
      src={inverted ? wordmarkWhiteUrl : wordmarkUrl}
      alt="Trigyan"
      sx={{ height: size, width: 'auto', display: 'block' }}
    />
  );
}

/** Wordmark plus the strapline, for the login card and printed headers. */
export function LogoLockup({
  size = 40,
  inverted = false,
  align = 'left',
}: Props & { align?: 'left' | 'center' }) {
  const centred = align === 'center';

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: centred ? 'center' : 'flex-start',
      }}
    >
      <Logo size={size} inverted={inverted} />
      <Typography
        component="span"
        sx={{
          fontFamily: '"Quicksand", "Inter", sans-serif',
          fontSize: size * 0.19,
          fontWeight: 600,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: inverted ? 'rgba(255,255,255,0.75)' : BRAND.green,
          mt: 0.75,
          // Letter-spacing hangs off the last character, so centred text sits
          // half a space to the right unless that trailing gap is taken back.
          ...(centred && { mr: '-0.18em' }),
        }}
      >
        Empowering Ideas
      </Typography>
    </Box>
  );
}
