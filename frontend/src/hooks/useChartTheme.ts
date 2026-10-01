/**
 * Axis, grid and tooltip colours for recharts.
 *
 * recharts styles its chrome through props, not CSS, so it cannot read the MUI
 * palette the way the rest of the app does - the values have to be handed to
 * it. Reading them from the theme here is what keeps the reports legible in
 * dark mode instead of drawing dark grey axes on a dark ground.
 */

import { useTheme } from '@mui/material/styles';

export function useChartTheme() {
  const theme = useTheme();
  return {
    axis: theme.palette.text.secondary,
    grid: theme.palette.divider,
    tooltip: {
      backgroundColor: theme.palette.background.paper,
      border: `1px solid ${theme.palette.divider}`,
      borderRadius: 10,
      color: theme.palette.text.primary,
      fontSize: 13,
    },
    // recharts draws its own hover band; the MUI action colour is too strong
    // against a chart, so it is dropped to a wash.
    cursor: { fill: theme.palette.action.hover },
  };
}
