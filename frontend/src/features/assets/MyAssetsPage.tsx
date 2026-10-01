/**
 * "What has the company given me?" — the employee's own asset register.
 *
 * The same list already appears as a card on their profile, but that is a
 * section of a page about *them*; this is the page you open when the question
 * is about the kit itself — reading a serial off the screen to quote in a
 * ticket, or checking what has to go back on your last day.
 *
 * So it is laid out for looking at rather than scanning past: the photo is
 * given real size, and the serial is monospaced and selectable, because the one
 * thing people actually do here is copy it.
 *
 * Read-only by design. Assets are issued and taken back by HR and Admin
 * (`asset.manage`); an employee cannot add to or edit their own register, and
 * the server refuses it whatever this page shows.
 */

import DevicesIcon from '@mui/icons-material/Devices';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useCallback } from 'react';

import { useAppSelector } from '@/app/hooks';
import { CardGridSkeleton, EmptyState, ErrorAlert } from '@/components/common/Feedback';
import PageHeader from '@/components/common/PageHeader';
import { selectCurrentUser } from '@/features/auth/authSlice';
import { useApiResource } from '@/hooks/useApiResource';
import { employeesApi } from '@/services/api/services';
import { ASSET_CONDITION_LABELS } from '@/types/domain';
import type { EmployeeAsset } from '@/types/domain';
import { formatDate } from '@/utils/date';

/** The photo, or a placeholder that keeps the card the same height either way. */
function AssetPhoto({ asset }: { asset: EmployeeAsset }) {
  const frame = {
    height: 180,
    borderRadius: 1.5,
    bgcolor: 'action.hover',
    display: 'grid',
    placeItems: 'center',
    overflow: 'hidden',
  } as const;

  if (!asset.photo_url) {
    return (
      <Box sx={frame}>
        <Stack alignItems="center" spacing={0.5}>
          <DevicesIcon sx={{ fontSize: 44, color: 'text.disabled' }} />
          <Typography variant="caption" color="text.disabled">
            No photo
          </Typography>
        </Stack>
      </Box>
    );
  }

  return (
    <Box sx={frame}>
      {/* Opens full size in a new tab: on a phone or a laptop lid the serial
          sticker is often only legible at full resolution. */}
      <Link
        href={asset.photo_url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open the photo of ${asset.name} full size`}
        sx={{ display: 'block', width: '100%', height: '100%' }}
      >
        <Box
          component="img"
          src={asset.photo_url}
          alt={asset.name}
          sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </Link>
    </Box>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={mono ? { fontFamily: 'monospace', userSelect: 'all' } : undefined}
      >
        {value || '-'}
      </Typography>
    </Box>
  );
}

export default function MyAssetsPage() {
  const user = useAppSelector(selectCurrentUser);
  const employeeId = user?.employee_id ?? null;

  const { data, loading, error, reload } = useApiResource(
    useCallback(
      () => (employeeId ? employeesApi.assets(employeeId) : Promise.resolve([])),
      [employeeId],
    ),
    [employeeId],
  );

  const assets = data ?? [];

  return (
    <>
      <PageHeader
        title="My assets"
        subtitle="Company equipment issued to you"
        actions={
          assets.length > 0 ? (
            <Chip
              icon={<DevicesIcon />}
              label={`${assets.length} item${assets.length === 1 ? '' : 's'}`}
              color="primary"
              variant="outlined"
            />
          ) : undefined
        }
      />

      {loading && <CardGridSkeleton cards={3} height={330} />}
      {error && <ErrorAlert error={error} onRetry={reload} />}

      {/* An account with no employment record - a bare administrator - has no
          register to show, and that is not an error. */}
      {!loading && !error && employeeId === null && (
        <EmptyState
          title="No employee record"
          detail="This account is not linked to an employment record, so it holds no company assets."
        />
      )}

      {!loading && !error && employeeId !== null && assets.length === 0 && (
        <EmptyState
          title="Nothing issued to you yet"
          detail="Laptops, phones and other company equipment appear here once HR records them against your name."
        />
      )}

      {assets.length > 0 && (
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: {
              xs: '1fr',
              sm: 'repeat(2, 1fr)',
              lg: 'repeat(3, 1fr)',
            },
          }}
        >
          {assets.map((asset) => (
            <Card
              key={asset.id}
              sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}
            >
              <CardContent sx={{ p: 2, flexGrow: 1, '&:last-child': { pb: 2 } }}>
                <AssetPhoto asset={asset} />

                <Typography
                  variant="h4"
                  component="h2"
                  sx={{ mt: 2 }}
                  noWrap
                  title={asset.name}
                >
                  {asset.name}
                </Typography>

                <Stack spacing={1.25} sx={{ mt: 1.5 }}>
                  <Detail label="Brand" value={asset.brand} />
                  <Detail label="Serial number" value={asset.serial_number} mono />
                  <Stack direction="row" spacing={3}>
                    <Detail
                      label="Issued on"
                      value={asset.issued_on ? formatDate(asset.issued_on) : 'Not recorded'}
                    />
                    <Detail
                      label="Condition"
                      value={ASSET_CONDITION_LABELS[asset.condition] ?? asset.condition}
                    />
                  </Stack>
                </Stack>

                {asset.photo_url && (
                  <Link
                    href={asset.photo_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    variant="caption"
                    sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, mt: 1.5 }}
                  >
                    View photo
                    <OpenInNewIcon sx={{ fontSize: 13 }} />
                  </Link>
                )}
              </CardContent>
            </Card>
          ))}
        </Box>
      )}

      {assets.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
          Something missing or wrong here? Ask HR — assets are issued and returned on their
          side.
        </Typography>
      )}
    </>
  );
}
