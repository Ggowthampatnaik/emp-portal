/**
 * The roles somebody can hold on a project.
 *
 * Mirrors `ProjectMember.ProjectRole` on the server, which is the authority.
 * Shared rather than declared beside whichever screen needed it first: the two
 * copies had drifted apart, and the team table was labelling values (`tester`,
 * `support`) the API will not accept while showing the ones it does accept
 * (`manager`, `qa`, `devops`) as raw slugs.
 */

export interface ProjectRole {
  value: string;
  label: string;
}

export const PROJECT_ROLES: ProjectRole[] = [
  { value: 'manager', label: 'Project manager' },
  { value: 'lead', label: 'Team lead' },
  { value: 'developer', label: 'Developer' },
  { value: 'qa', label: 'QA' },
  { value: 'analyst', label: 'Business analyst' },
  { value: 'designer', label: 'Designer' },
  { value: 'devops', label: 'DevOps' },
];

/** The label for a stored value, falling back to the value itself. */
export function projectRoleLabel(value: string): string {
  return PROJECT_ROLES.find((role) => role.value === value)?.label ?? value;
}
