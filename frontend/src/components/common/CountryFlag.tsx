/**
 * A country's flag, drawn as an SVG from the `country-flag-icons` package.
 *
 * Not an emoji: Windows has no flag emoji, so Chrome and Edge there show the
 * two letters ("IN") instead of 🇮🇳 - and Windows is what most of the company
 * uses. The SVGs ship with the portal, so nothing is fetched from elsewhere.
 */

import Box from '@mui/material/Box';
import * as Flags from 'country-flag-icons/react/3x2';
import type { ComponentType, SVGAttributes } from 'react';

const BY_CODE = Flags as unknown as Record<string, ComponentType<SVGAttributes<SVGElement>>>;

interface Props {
  /** ISO country code - "IN". */
  code: string;
  /** Width in px; the flag is 3:2. */
  width?: number;
}

export default function CountryFlag({ code, width = 22 }: Props) {
  const Flag = BY_CODE[code.toUpperCase()];
  const sx = {
    width,
    height: Math.round((width * 2) / 3),
    flexShrink: 0,
    borderRadius: '2px',
    // A hairline, so white flags (Japan, Cyprus) still have an edge.
    boxShadow: '0 0 0 1px rgba(0,0,0,0.12)',
    display: 'block',
  };
  // An unknown code keeps its space, so a list stays aligned.
  if (!Flag) return <Box aria-hidden sx={{ ...sx, bgcolor: 'action.hover' }} />;
  return <Box component={Flag} aria-hidden sx={sx} />;
}
