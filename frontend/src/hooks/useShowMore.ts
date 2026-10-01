/**
 * How much of a list a profile card shows, and the dialog holding the rest.
 *
 * Cards sit in pairs, so a list that grows decides how tall its neighbour has
 * to be. Showing one entry and putting the rest in a dialog keeps every card
 * the same size whatever the data does - which is what lets Skills sit level
 * with Experience, and Documents with Assets.
 */

import { useState } from 'react';

/** Entries a list card shows before the rest go in the dialog. */
export const PROFILE_ROWS = 1;

/**
 * Skills are chips rather than rows, and four of them wrap to about the height
 * of one Experience row - which is what keeps that pair level.
 */
export const PROFILE_CHIPS = 4;

export interface ShowMore<T> {
  /** What the card renders. */
  visible: T[];
  /** How many are only in the dialog; 0 when everything already shows. */
  hidden: number;
  /** Whether the dialog is open. */
  open: boolean;
  show: () => void;
  close: () => void;
}

export function useShowMore<T>(items: T[], limit: number = PROFILE_ROWS): ShowMore<T> {
  const [open, setOpen] = useState(false);
  return {
    visible: items.slice(0, limit),
    hidden: Math.max(0, items.length - limit),
    open,
    show: () => setOpen(true),
    close: () => setOpen(false),
  };
}
