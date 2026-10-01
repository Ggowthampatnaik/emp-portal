/**
 * Company assets issued to an employee — laptop, phone, monitor.
 *
 * Everyone who can open the profile can see the kit, because "what am I
 * holding?" is a question people ask about themselves. Only `asset.manage`
 * (HR and Admin) can issue, amend or take one back: handing over hardware is a
 * custody decision rather than a profile edit.
 *
 * The photo is optional. Kit is usually handed over before anyone gets round
 * to photographing it, so the row has to be worth creating without one.
 */

import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import DevicesIcon from '@mui/icons-material/Devices';
import EditIcon from '@mui/icons-material/Edit';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useCallback, useState } from 'react';

import { useAppDispatch } from '@/app/hooks';
import SectionCard from '@/components/common/SectionCard';
import ShowMoreButton from '@/components/common/ShowMoreButton';
import ViewAllDialog from '@/components/common/ViewAllDialog';
import { ErrorAlert } from '@/components/common/Feedback';
import AssetDialog from '@/features/employees/AssetDialog';
import { showToast } from '@/features/ui/uiSlice';
import { useApiAction, useApiResource } from '@/hooks/useApiResource';
import { useShowMore } from '@/hooks/useShowMore';
import { employeesApi } from '@/services/api/services';
import type { EmployeeAsset } from '@/types/domain';

/** One issued item. The card and the dialog behind it render the same row. */
function AssetRow({
  asset,
  canManage,
  busy,
  onEdit,
  onRemove,
}: {
  asset: EmployeeAsset;
  canManage: boolean;
  busy: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <Stack
      direction="row"
      spacing={2}
      alignItems="center"
      sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}
    >
      <Avatar
        variant="rounded"
        src={asset.photo_url ?? undefined}
        alt=""
        sx={{ width: 56, height: 56, bgcolor: 'action.hover', color: 'text.secondary' }}
      >
        <DevicesIcon />
      </Avatar>

      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Typography variant="subtitle2" noWrap>
          {asset.name}
        </Typography>
        <Typography variant="body2" color="text.secondary" noWrap>
          {asset.brand}
        </Typography>
        {/* Monospaced: serials are read off a sticker and typed back in, so
            0/O and 1/l need to be tellable apart. */}
        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
          {asset.serial_number}
        </Typography>
      </Box>

      {canManage && (
        <Stack direction="row" spacing={0.5}>
          <Tooltip title="Edit">
            <IconButton size="small" onClick={onEdit} aria-label={`Edit ${asset.name}`}>
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Remove">
            <IconButton
              size="small"
              onClick={onRemove}
              disabled={busy}
              aria-label={`Remove ${asset.name}`}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      )}
    </Stack>
  );
}

export default function AssetsCard({
  employeeId,
  canManage,
}: {
  employeeId: number;
  /** `asset.manage` — HR and Admin. Everyone else gets a read-only list. */
  canManage: boolean;
}) {
  const dispatch = useAppDispatch();
  const [editing, setEditing] = useState<EmployeeAsset | null>(null);
  const [adding, setAdding] = useState(false);

  const { data, loading, error, reload } = useApiResource(
    useCallback(() => employeesApi.assets(employeeId), [employeeId]),
    [employeeId],
  );

  const remove = useApiAction(async (assetId: number) => {
    await employeesApi.removeAsset(employeeId, assetId);
    // A 204 resolves nothing; `run` also resolves nothing when it fails.
    return true as const;
  });

  const handleRemove = async (asset: EmployeeAsset) => {
    const done = await remove.run(asset.id);
    if (!done) return;
    dispatch(showToast(`${asset.name} removed.`, 'success'));
    reload();
  };

  const assets = data ?? [];
  const more = useShowMore(assets);

  return (
    <SectionCard
      title="Assets"
      icon={<DevicesIcon color="primary" />}
      subtitle="Company equipment issued to this employee."
      count={assets.length}
      footer={<ShowMoreButton hidden={more.hidden} onClick={more.show} noun="items" />}
      action={
        canManage ? (
          <Button size="small" startIcon={<AddIcon />} onClick={() => setAdding(true)}>
            Issue asset
          </Button>
        ) : undefined
      }
    >
      {loading && <LinearProgress />}
      {error && <ErrorAlert error={error} onRetry={reload} />}
      {remove.error && <ErrorAlert error={remove.error} />}

      {!loading && !error && assets.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          {canManage
            ? 'Nothing issued yet. Use "Issue asset" to record a laptop, phone or monitor.'
            : 'Nothing is currently issued to this employee.'}
        </Typography>
      )}

      <Stack spacing={1.5}>
        {more.visible.map((asset) => (
          <AssetRow
            key={asset.id}
            asset={asset}
            canManage={canManage}
            busy={remove.busy}
            onEdit={() => setEditing(asset)}
            onRemove={() => handleRemove(asset)}
          />
        ))}
      </Stack>

      <ViewAllDialog
        open={more.open}
        onClose={more.close}
        title={`Assets · ${assets.length} item${assets.length === 1 ? '' : 's'}`}
      >
        <Stack spacing={1.5}>
          {assets.map((asset) => (
            <AssetRow
              key={asset.id}
              asset={asset}
              canManage={canManage}
              busy={remove.busy}
              onEdit={() => {
                more.close();
                setEditing(asset);
              }}
              onRemove={() => handleRemove(asset)}
            />
          ))}
        </Stack>
      </ViewAllDialog>

      {(adding || editing) && (
        <AssetDialog
          employeeId={employeeId}
          asset={editing}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={() => {
            setAdding(false);
            setEditing(null);
            reload();
          }}
        />
      )}
    </SectionCard>
  );
}
