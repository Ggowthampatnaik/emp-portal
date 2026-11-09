/**
 * Column widths shared by the project list and the team panel that opens under
 * a row, so the panel's Employee sits under Code and Project, Role under Client,
 * Allocation under Total allocation and Start under Start. In pixels, each just
 * wider than its content, so the columns stop at the edge of the page with no
 * sideways scrolling. Project (and the panel's Employee) takes what is left.
 */
export const COLUMNS = {
  expander: 56,
  code: 95,
  client: 140,
  manager: 130,
  team: 70,
  allocation: 145,
  start: 125,
  status: 120,
} as const;

export const TEAM_COLUMNS = {
  /** An empty first column, under the list's arrows. */
  indent: COLUMNS.expander,
  role: COLUMNS.client + COLUMNS.manager + COLUMNS.team,
  allocation: COLUMNS.allocation,
  start: COLUMNS.start,
  actions: COLUMNS.status,
} as const;
