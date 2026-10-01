/**
 * Everything about one project, shown in place under its row.
 *
 * This replaced the separate detail page, so it carries what that page did:
 * who is on the team, what each of them is allocated, and — for anyone holding
 * `project.assign_team` or `project.allocate` — the controls to change it.
 * Deleting the page without moving those would have left the API able to staff
 * a project and the UI unable to.
 *
 * One request, not two: `detail` returns members and allocations together, so
 * expanding a row costs a single call and the two lists cannot disagree with
 * each other halfway through a change.
 *
 * Membership and allocation are separate records on purpose — somebody can be
 * on a team with no current allocation, which is why the table says "Not
 * allocated" rather than assuming the two line up.
 */

import AddIcon from '@mui/icons-material/Add';
import PercentIcon from '@mui/icons-material/Percent';
import PersonRemoveIcon from '@mui/icons-material/PersonRemove';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useCallback, useState } from 'react';

import { useAppDispatch } from '@/app/hooks';
import { ErrorAlert } from '@/components/common/Feedback';
import AddAllocationDialog from '@/features/projects/AddAllocationDialog';
import AddTeamMemberDialog from '@/features/projects/AddTeamMemberDialog';
import { showToast } from '@/features/ui/uiSlice';
import { usePermissions } from '@/hooks/usePermissions';
import { useApiAction, useApiResource } from '@/hooks/useApiResource';
import { projectRoleLabel } from '@/features/projects/roles';
import { projectsApi } from '@/services/api/services';

export default function ProjectTeamRow({ projectId }: { projectId: number }) {
  const dispatch = useAppDispatch();
  const { can } = usePermissions();
  const mayStaff = can('project.assign_team');
  const mayAllocate = can('project.allocate');

  const [addingMember, setAddingMember] = useState(false);
  const [allocating, setAllocating] = useState(false);

  const { data, loading, error, reload } = useApiResource(
    useCallback(() => projectsApi.detail(projectId), [projectId]),
    [projectId],
  );

  const removeMember = useApiAction(async (memberId: number) => {
    await projectsApi.removeMember(projectId, memberId);
    // A 204 resolves nothing; `run` also resolves nothing when it fails.
    return true as const;
  });
  const removeAllocation = useApiAction(async (allocationId: number) => {
    await projectsApi.removeAllocation(projectId, allocationId);
    return true as const;
  });

  if (loading) return <LinearProgress sx={{ my: 2, maxWidth: 280 }} />;
  if (error) return <ErrorAlert error={error} onRetry={reload} />;
  if (!data) return null;

  const members = data.members.filter((member) => member.is_active);
  const allocations = data.allocations.filter((allocation) => allocation.is_active);
  const totalAllocation = allocations.reduce(
    (sum, row) => sum + Number(row.allocation_percentage),
    0,
  );

  /** The active allocation for one employee, if they have one. */
  const allocationFor = (employeeId: number) =>
    allocations.find((allocation) => allocation.employee === employeeId);

  const handleRemoveMember = async (memberId: number, name: string) => {
    const done = await removeMember.run(memberId);
    if (!done) return;
    dispatch(showToast(`${name} taken off the team.`, 'success'));
    reload();
  };

  const handleRemoveAllocation = async (allocationId: number, name: string) => {
    const done = await removeAllocation.run(allocationId);
    if (!done) return;
    dispatch(showToast(`${name}'s allocation removed.`, 'success'));
    reload();
  };

  return (
    <Box sx={{ py: 2 }}>
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 1.5 }}
      >
        <Stack direction="row" spacing={1.5} alignItems="baseline">
          <Typography variant="subtitle2">Assigned employees ({members.length})</Typography>
          {allocations.length > 0 && (
            <Typography variant="caption" color="text.secondary">
              {totalAllocation.toFixed(0)}% of a person allocated in total
            </Typography>
          )}
        </Stack>

        <Stack direction="row" spacing={1}>
          {mayStaff && (
            <Button size="small" startIcon={<AddIcon />} onClick={() => setAddingMember(true)}>
              Add member
            </Button>
          )}
          {mayAllocate && (
            <Button size="small" startIcon={<AddIcon />} onClick={() => setAllocating(true)}>
              Allocate
            </Button>
          )}
        </Stack>
      </Stack>

      {removeMember.error && <ErrorAlert error={removeMember.error} />}
      {removeAllocation.error && <ErrorAlert error={removeAllocation.error} />}

      {members.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
          Nobody is currently assigned to this project.
        </Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Employee</TableCell>
              <TableCell>Role on project</TableCell>
              <TableCell align="right">Allocation</TableCell>
              {(mayStaff || mayAllocate) && <TableCell align="right" sx={{ width: 96 }} />}
            </TableRow>
          </TableHead>
          <TableBody>
            {members.map((member) => {
              const allocation = allocationFor(member.employee);
              return (
                <TableRow key={member.id}>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>
                      {member.employee_name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {member.employee_code}
                      {member.designation ? ` · ${member.designation}` : ''}
                    </Typography>
                  </TableCell>

                  <TableCell>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={projectRoleLabel(member.role_in_project)}
                    />
                  </TableCell>

                  <TableCell align="right">
                    {allocation ? (
                      <Typography variant="body2" fontWeight={600}>
                        {Number(allocation.allocation_percentage).toFixed(0)}%
                      </Typography>
                    ) : (
                      <Typography variant="caption" color="text.disabled">
                        Not allocated
                      </Typography>
                    )}
                  </TableCell>

                  {(mayStaff || mayAllocate) && (
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                        {mayAllocate && allocation && (
                          <Tooltip title="Remove allocation">
                            <IconButton
                              size="small"
                              aria-label={`Remove ${member.employee_name}'s allocation`}
                              disabled={removeAllocation.busy}
                              onClick={() =>
                                handleRemoveAllocation(allocation.id, member.employee_name)
                              }
                            >
                              <PercentIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                        {mayStaff && (
                          <Tooltip title="Take off the team">
                            <IconButton
                              size="small"
                              aria-label={`Take ${member.employee_name} off the team`}
                              disabled={removeMember.busy}
                              onClick={() =>
                                handleRemoveMember(member.id, member.employee_name)
                              }
                            >
                              <PersonRemoveIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Stack>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {/* Allocated but not on the team: a real state, and one nobody would
          otherwise see, because the table above is driven by membership. */}
      {allocations.some((a) => !members.some((m) => m.employee === a.employee)) && (
        <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 1.5 }}>
          Some allocations belong to people who are no longer on the team.
        </Typography>
      )}

      {addingMember && (
        <AddTeamMemberDialog
          projectId={projectId}
          onClose={() => setAddingMember(false)}
          onSaved={() => {
            setAddingMember(false);
            reload();
          }}
        />
      )}
      {allocating && (
        <AddAllocationDialog
          projectId={projectId}
          onClose={() => setAllocating(false)}
          onSaved={() => {
            setAllocating(false);
            reload();
          }}
        />
      )}
    </Box>
  );
}
