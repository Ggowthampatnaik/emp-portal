/**
 * Column widths shared by the project list and the team panel that opens
 * under a row. Both tables span the same width, so the same percentages land
 * in the same places: the panel's Employee sits under Code and Project, Role
 * under Client, Allocation under Total allocation and Start under Start. Percentages rather than
 * pixels spread the spare width across every column instead of handing it all
 * to one. Status (and the panel's last column) takes what is left.
 */
export const COLUMNS = {
  expander: 56,
  code: '8%',
  project: '22%',
  client: '15%',
  manager: '13%',
  team: '7%',
  allocation: '11%',
  start: '10%',
} as const;

export const TEAM_COLUMNS = {
  /** An empty first column, under the list's arrows. */
  indent: COLUMNS.expander,
  employee: '30%',
  role: '35%',
  allocation: COLUMNS.allocation,
  start: COLUMNS.start,
} as const;
