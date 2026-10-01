/**
 * Colour that says *which*, not *how it is going*.
 *
 * The palette already spends green, amber and red on state - approved,
 * pending, rejected - and the theme is deliberate that those hues mean nothing
 * else. That left every category in the portal grey: five leave types drawn as
 * five identical outlined chips, six departments the same, so a page of them
 * carried no information until you read every label.
 *
 * These hues fill that gap. They are assigned from the label itself, so a
 * department is the same colour on the Employees page, the org chart and a
 * report, and a leave type is the same colour wherever it appears - which is
 * what makes the colour worth reading at all. Nothing here is semantic: a
 * category is not better or worse for being violet.
 *
 * Told apart from state at a glance by treatment as much as hue: identity is
 * always a soft tint behind deep text, state is always a filled chip.
 */

import { alpha, lighten } from '@mui/material/styles';

/**
 * Eight hues that hold against both grounds, chosen to sit beside the brand
 * blue rather than compete with it. Green, amber and red are deliberately
 * absent - they belong to state.
 */
export const IDENTITY_HUES = [
  '#3E6FB0', // brand blue, deepened
  '#7E5AA8', // violet
  '#2E8C8C', // teal
  '#9A5B7E', // plum
  '#4A6FA5', // indigo
  '#2F7FA8', // cyan-blue
  '#7A6BB5', // periwinkle
  '#5C7C99', // slate
] as const;

/**
 * A stable index for a label.
 *
 * Deliberately a plain sum rather than a real hash: the strings are short and
 * few, the result has to be identical in every browser and every release, and
 * nothing here is a security boundary. What matters is that "Engineering"
 * always lands on the same hue.
 */
function hueIndex(label: string): number {
  let total = 0;
  for (const character of label.trim().toLowerCase()) {
    total = (total + character.charCodeAt(0) * 31) % 10007;
  }
  return total % IDENTITY_HUES.length;
}

/** The hue a category is always drawn in. */
export function identityHue(label: string | null | undefined): string {
  return IDENTITY_HUES[hueIndex(label ?? '')]!;
}

/**
 * Chip styling for a category: a soft wash of its hue, text in the hue itself.
 *
 * Both are derived from one colour, so the pair can never drift apart, and the
 * wash is weak enough (14% light, 26% dark) that a row of these reads as
 * information rather than decoration.
 */
export function identityChipSx(label: string | null | undefined) {
  return (theme: { palette: { mode: 'light' | 'dark' } }) => {
    const hue = identityHue(label);
    const dark = theme.palette.mode === 'dark';
    return {
      backgroundColor: alpha(hue, dark ? 0.26 : 0.14),
      // These hues are mid-tone: readable on white, too dark on the dark
      // ground, so the text is lifted rather than the wash deepened.
      color: dark ? lighten(hue, 0.5) : hue,
      border: `1px solid ${alpha(hue, dark ? 0.42 : 0.28)}`,
      fontWeight: 600,
      // The icon a chip may carry (a location pin, a leave code) takes the
      // same colour rather than MUI's default grey.
      '& .MuiChip-icon': { color: 'inherit' },
    };
  };
}
