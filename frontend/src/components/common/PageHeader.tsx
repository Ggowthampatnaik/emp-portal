import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, type ReactNode } from 'react';

import { BRAND, CARD_SHADOW, RAIL } from '@/styles/theme';

interface Props {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export default function PageHeader({ title, subtitle, actions }: Props) {
  // Every in-app page renders through this header, so the browser tab is
  // named here once - "Leave · Trigyan Portal" - rather than per page. The
  // cleanup restores the default for the pages that have no header (sign-in).
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} · Trigyan Portal`;
    return () => {
      document.title = previous;
    };
  }, [title]);
  return (
    <Box
      sx={(theme) => ({
        mb: 3,
        px: { xs: 2.5, md: 4 },
        py: { xs: 3, md: 3.5 },
        borderRadius: 2,
        position: 'relative',
        overflow: 'hidden',
        color: '#FFFFFF',
        // The logo's two colours, as the rail has them: its blue as the
        // ground, opening out to the right, with the leaf green as a glow
        // and a stripe along the foot. Dark mode keeps the deep navy so the
        // panel does not become the brightest thing on a dark page.
        backgroundImage:
          theme.palette.mode === 'light'
            ? `linear-gradient(115deg, ${BRAND.blueDark} 0%, ${RAIL.top} 100%)`
            : `linear-gradient(115deg, ${RAIL.baseDark} 0%, ${RAIL.topDark} 42%, ${BRAND.blueDark} 100%)`,
        boxShadow: CARD_SHADOW[theme.palette.mode].rest,
        '&::after': {
          content: '""',
          position: 'absolute',
          inset: 0,
          background: [
            'radial-gradient(520px 240px at 96% -40%, rgba(140,198,63,0.30), transparent 70%)',
            'radial-gradient(620px 280px at 70% -40%, rgba(255,255,255,0.12), transparent 70%)',
          ].join(', '),
          pointerEvents: 'none',
        },
        '&::before': {
          content: '""',
          position: 'absolute',
          insetInline: 0,
          bottom: 0,
          height: 4,
          background: `linear-gradient(90deg, ${BRAND.green} 0%, ${BRAND.greenDark} 35%, ${BRAND.blue} 100%)`,
          pointerEvents: 'none',
        },
      })}
    >
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', md: 'center' }}
        spacing={2.5}
        sx={{ position: 'relative', zIndex: 1 }}
      >
        <Box>
          <Typography variant="h1" component="h1">
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="body2" sx={{ mt: 0.5, color: 'rgba(255,255,255,0.76)' }}>
              {subtitle}
            </Typography>
          )}
        </Box>

        {/* Pages hand their controls over dressed for a light ground, because
            that is where they used to sit. Rather than ask nineteen pages to
            restyle their own buttons - and to remember to, next time one is
            added - the panel dresses whatever it is given. One filled button
            reads as the page's primary action in white; everything else is an
            outline on the navy. */}
        {actions && (
          <Box
            sx={{
              flexShrink: 0,
              '& .MuiButton-root': { color: '#FFFFFF' },
              '& .MuiButton-contained': {
                backgroundColor: '#FFFFFF',
                color: BRAND.blueDark,
                '&:hover': { backgroundColor: 'rgba(255,255,255,0.88)' },
              },
              '& .MuiButton-outlined': {
                borderColor: 'rgba(255,255,255,0.45)',
                '&:hover': {
                  borderColor: '#FFFFFF',
                  backgroundColor: 'rgba(255,255,255,0.12)',
                },
              },
              '& .MuiButton-text:hover': { backgroundColor: 'rgba(255,255,255,0.12)' },
              '& .MuiIconButton-root': { color: '#FFFFFF' },
              // Segmented controls - the Holidays list/calendar switch - keep
              // their shape and invert: the chosen side is the solid one.
              '& .MuiToggleButton-root': {
                color: 'rgba(255,255,255,0.82)',
                borderColor: 'rgba(255,255,255,0.35)',
                '&.Mui-selected': {
                  backgroundColor: '#FFFFFF',
                  color: BRAND.blueDark,
                  '&:hover': { backgroundColor: 'rgba(255,255,255,0.88)' },
                },
                '&:hover': { backgroundColor: 'rgba(255,255,255,0.12)' },
              },
              // A plain outlined chip in the header is a label, not a state,
              // so it follows the outlines. Filled chips are status and keep
              // their own colour.
              '& .MuiChip-outlined': {
                color: '#FFFFFF',
                borderColor: 'rgba(255,255,255,0.45)',
              },
              // Fields live up here too - the year a holiday calendar is
              // showing, for one. Border, label, value and the select's
              // chevron all have to come with the rest, or the control is
              // legible everywhere except where it is.
              '& .MuiInputBase-root': { color: '#FFFFFF' },
              '& .MuiInputLabel-root': { color: 'rgba(255,255,255,0.72)' },
              '& .MuiInputLabel-root.Mui-focused': { color: '#FFFFFF' },
              '& .MuiSelect-icon': { color: 'rgba(255,255,255,0.82)' },
              '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.45)' },
              '& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline': {
                borderColor: '#FFFFFF',
              },
              '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': {
                borderColor: '#FFFFFF',
              },
            }}
          >
            {actions}
          </Box>
        )}
      </Stack>
    </Box>
  );
}
