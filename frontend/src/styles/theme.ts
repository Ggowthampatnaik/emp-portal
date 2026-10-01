/**
 * MUI theme, built from the Trigyan logo. Palette: "Slate".
 *
 * `BRAND` holds the logo colours exactly as drawn and never changes - it is the
 * artwork. `SLATE` is the neutral system the interface is built on, and the
 * palette derives from the two together.
 *
 * Slate replaced a lighter, warmer-blue scheme for three reasons, all of which
 * showed up on the table-heavy pages:
 *
 * 1. White cards on the old #F5F8FC ground were about 3% apart, so on Employees
 *    or Administration the cards barely read as raised. The ground drops to
 *    #EFF2F7 and the divider deepens, which is what gives a card an edge.
 * 2. `primary.main` moves a step deeper, to the logo's darkest blue. The
 *    mid-blue it replaced sat close enough to Material's default that the
 *    portal read as un-themed.
 * 3. Green is now reserved for meaning - approved, active, released. It used to
 *    appear decoratively on icons, which meant it could not be trusted to
 *    signal anything.
 *
 * Corners tighten from 12px to 8px. That single number does more than any
 * colour to make an interface read as precise rather than consumer.
 */

import { createTheme, type Theme } from '@mui/material/styles';

export const BRAND = {
  /** The blue of the wordmark. */
  blue: '#6B9BD6',
  blueDeep: '#4A7CBE',
  blueDark: '#2F5A93',
  blueSoft: '#E8F0FA',
  /** The green of the leaf, eyes and wing. */
  green: '#8CC63F',
  greenDark: '#6BA22C',
  greenSoft: '#F0F8E4',
  ink: '#2E3A4A',
} as const;

/**
 * The neutral system. Cool, with a slight blue bias so it sits under the brand
 * hues rather than fighting them - a pure grey next to this blue reads muddy.
 */
export const SLATE = {
  ground: '#EFF2F7',
  surface: '#FFFFFF',
  line: '#D8E0EA',
  ink: '#1E2733',
  inkMuted: '#56637A',
  /** Selected nav item and other tinted-blue surfaces, light mode. */
  tint: '#E3EBF5',
  tintInk: '#1F4372',
  /** Table headers - a whisper of the ground, not a blue band. */
  headRow: '#F2F5F9',

  groundDark: '#0F1622',
  surfaceDark: '#18212F',
  lineDark: 'rgba(255,255,255,0.10)',
  inkDark: '#E8EDF4',
  inkMutedDark: '#A6B3C4',
  tintDark: 'rgba(107,155,214,0.16)',
  tintInkDark: '#CFE1F5',
  headRowDark: 'rgba(255,255,255,0.03)',
} as const;

/**
 * The ambient wash behind the page.
 *
 * A flat neutral ground is honest but inert - on a portal that is mostly cards
 * on an empty field it reads as unfinished. Two very soft radial pools, one per
 * brand hue, give the field some depth without becoming decoration: they sit
 * under everything, carry no meaning, and are weak enough (16% and 10%) that
 * text contrast on the ground is untouched.
 *
 * Anchored to the top of the layout rather than `fixed`, which stutters badly
 * on a long scrolling page in Safari and on Windows trackpads.
 */
export const ambientBackground = (mode: 'light' | 'dark'): string =>
  mode === 'light'
    ? [
        'radial-gradient(1100px 520px at 8% -10%, rgba(107,155,214,0.16), transparent 62%)',
        'radial-gradient(820px 420px at 96% 2%, rgba(140,198,63,0.10), transparent 64%)',
      ].join(', ')
    : [
        'radial-gradient(1100px 520px at 8% -10%, rgba(107,155,214,0.14), transparent 62%)',
        'radial-gradient(820px 420px at 96% 2%, rgba(140,198,63,0.06), transparent 64%)',
      ].join(', ');

/** Resting and raised shadows for cards that respond to the pointer. */
export const CARD_SHADOW = {
  light: {
    rest: '0 1px 2px rgba(20,35,60,0.05), 0 6px 16px rgba(20,35,60,0.05)',
    hover: '0 2px 4px rgba(20,35,60,0.07), 0 14px 32px rgba(20,35,60,0.11)',
  },
  dark: {
    rest: '0 1px 2px rgba(0,0,0,0.35), 0 6px 16px rgba(0,0,0,0.28)',
    hover: '0 2px 6px rgba(0,0,0,0.45), 0 16px 36px rgba(0,0,0,0.42)',
  },
} as const;

/**
 * The navigation rail.
 *
 * The portal used to be white nav on a near-white page, which is honest and
 * completely flat: the eye had nothing to anchor on, and every screenshot read
 * as one pale rectangle. A dark rail against a light working area is the
 * oldest move in application design because it does two things at once - it
 * gives the page a spine, and it takes navigation *out* of the content's
 * visual competition, so the numbers a person came to read are the brightest
 * thing on screen.
 *
 * The logo's own blue, with its green as the accent - the same pairing as the
 * artwork. The rail runs from a step below the wordmark blue down to
 * `BRAND.blueDark`. The wordmark blue itself (#6B9BD6) is too pale to carry
 * white text (2.9:1); #3F70B0 is the lightest that still clears 4.5:1, and the
 * base is 7:1. The selected item is a white pill with a green icon and marker,
 * so the active module reads in both logo colours at once.
 */
export const RAIL = {
  top: '#3F70B0',
  base: BRAND.blueDark,
  /** Resting nav text: white, a touch softer than the selected item. */
  ink: 'rgba(255,255,255,0.92)',
  inkStrong: '#FFFFFF',
  /** The selected pill and its text, light mode. */
  selected: '#FFFFFF',
  selectedInk: BRAND.blueDark,
  /** Hover wash, the dark-mode selected pill, and the hairline under the logo. */
  tint: 'rgba(255,255,255,0.14)',
  line: 'rgba(255,255,255,0.16)',
  /** In dark mode the rail steps *below* the page rather than above it. */
  topDark: '#0D1927',
  baseDark: '#080F1A',
} as const;

export const STATUS_COLORS = {
  draft: '#7A8798',
  pending: '#E8A33D',
  approved: BRAND.greenDark,
  rejected: '#D2544B',
  cancelled: '#A8B2BF',
} as const;

/**
 * Categorical series colours for charts.
 *
 * Ordered so neighbouring series stay distinguishable, and picked to hold up
 * on both the light (#EFF2F7) and dark (#0F1622) grounds - the reports render
 * in whichever mode the reader has chosen. Opens on the two brand hues so a
 * one- or two-series chart is unmistakably Trigyan, then moves away from them
 * rather than shading the same blue paler and paler, which is the pattern that
 * stops being readable at four categories.
 */
export const CHART_SERIES = [
  BRAND.blueDeep,
  BRAND.greenDark,
  '#E8A33D',
  '#8E6FBF',
  '#3FA9A2',
  '#D2544B',
  '#6B7E95',
  '#C48A2E',
] as const;

/**
 * Colours for the workflow states, so a chart of approved/pending/rejected
 * agrees with the `StatusChip` beside it.
 */
export const CHART_STATUS = {
  approved: BRAND.greenDark,
  pending: STATUS_COLORS.pending,
  rejected: STATUS_COLORS.rejected,
} as const;

const FONT_STACK = [
  'Inter',
  'Quicksand',
  'Segoe UI',
  'Roboto',
  'Helvetica',
  'Arial',
  'sans-serif',
].join(',');

const HEADING_STACK = ['Quicksand', 'Inter', 'Segoe UI', 'sans-serif'].join(',');

export const buildTheme = (mode: 'light' | 'dark'): Theme =>
  createTheme({
    palette: {
      mode,
      // Primary is mode-aware. A single value cannot serve both grounds: the
      // deep blue that carries white text on white would be near-invisible on
      // #0F1622, and the light blue that reads on dark fails contrast on white.
      primary:
        mode === 'light'
          ? {
              main: BRAND.blueDark,
              light: BRAND.blueDeep,
              dark: '#1F4372',
              contrastText: '#FFFFFF',
            }
          : {
              main: BRAND.blue,
              light: '#9CC0E6',
              dark: BRAND.blueDeep,
              contrastText: '#0F1622',
            },
      secondary: {
        main: BRAND.greenDark,
        light: BRAND.green,
        dark: '#4F7A1F',
        contrastText: '#FFFFFF',
      },
      success: { main: STATUS_COLORS.approved },
      warning: { main: STATUS_COLORS.pending },
      error: { main: STATUS_COLORS.rejected },
      info: { main: mode === 'light' ? BRAND.blueDeep : BRAND.blue },
      text:
        mode === 'light'
          ? { primary: SLATE.ink, secondary: SLATE.inkMuted }
          : { primary: SLATE.inkDark, secondary: SLATE.inkMutedDark },
      background:
        mode === 'light'
          ? { default: SLATE.ground, paper: SLATE.surface }
          : { default: SLATE.groundDark, paper: SLATE.surfaceDark },
      divider: mode === 'light' ? SLATE.line : SLATE.lineDark,
    },
    typography: {
      fontFamily: FONT_STACK,
      h1: { fontFamily: HEADING_STACK, fontSize: '1.75rem', fontWeight: 700 },
      h2: { fontFamily: HEADING_STACK, fontSize: '1.5rem', fontWeight: 700 },
      h3: { fontFamily: HEADING_STACK, fontSize: '1.25rem', fontWeight: 600 },
      h4: { fontFamily: HEADING_STACK, fontSize: '1.125rem', fontWeight: 600 },
      subtitle2: { fontWeight: 600 },
      button: { textTransform: 'none', fontWeight: 600 },
    },
    // 8, not 12. The tighter corner is what makes a data-dense interface read
    // as precise; 12 belongs on a consumer app.
    shape: { borderRadius: 8 },
    components: {
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: { root: { borderRadius: 8 } },
      },
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
      MuiCard: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          // Border *and* a resting shadow. Border alone left every card sitting
          // flat on the ground, which is most of what made the portal read as
          // plain - a page of outlined rectangles has no depth to it. The
          // shadow is deliberately shallow: enough to lift the card off the
          // wash behind it, not enough to look like a floating dialog.
          root: ({ theme }) => ({
            border: `1px solid ${theme.palette.divider}`,
            boxShadow: CARD_SHADOW[theme.palette.mode].rest,
          }),
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: ({ theme }) => ({
            backgroundColor: theme.palette.background.paper,
            backgroundImage: 'none',
          }),
        },
      },
      MuiTableCell: {
        styleOverrides: {
          head: ({ theme }) => ({
            fontWeight: 700,
            color: theme.palette.text.secondary,
            // A whisper of the ground rather than a blue band: at eight columns
            // the old tint read as a coloured stripe across every table.
            backgroundColor: theme.palette.mode === 'light' ? SLATE.headRow : SLATE.headRowDark,
          }),
        },
      },
      MuiTab: { styleOverrides: { root: { textTransform: 'none', fontWeight: 600 } } },
      MuiChip: { styleOverrides: { root: { fontWeight: 600 } } },
      MuiLinearProgress: { styleOverrides: { root: { borderRadius: 4 } } },
    },
  });
