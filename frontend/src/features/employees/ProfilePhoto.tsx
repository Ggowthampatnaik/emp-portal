/**
 * Profile photo: avatar with hover-to-change, plus remove.
 *
 * The file never touches component state - it goes straight to the upload, and
 * the returned URL replaces the avatar. Size and type are checked here for a
 * fast message, and again on the server, which is what actually enforces them.
 */

import DeleteIcon from '@mui/icons-material/Delete';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import Alert from '@mui/material/Alert';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useRef, useState, type ChangeEvent } from 'react';

import { useAppDispatch } from '@/app/hooks';
import { restoreSession } from '@/features/auth/authSlice';
import { showToast } from '@/features/ui/uiSlice';
import { useApiAction } from '@/hooks/useApiResource';
import { employeesApi } from '@/services/api/services';

const MAX_MB = 5;
const ACCEPTED = 'image/jpeg,image/png,image/webp';

interface Props {
  employeeId: number;
  fullName: string;
  photoUrl: string | null;
  /** False for a record the caller may view but not change. */
  editable: boolean;
  /** True when this is the signed-in user, so the topbar avatar refreshes too. */
  isSelf?: boolean;
  onChanged: (photoUrl: string | null) => void;
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export default function ProfilePhoto({
  employeeId,
  fullName,
  photoUrl,
  editable,
  isSelf = false,
  onChanged,
}: Props) {
  const dispatch = useAppDispatch();
  const inputRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const upload = useApiAction(employeesApi.uploadPhoto);
  const remove = useApiAction(employeesApi.removePhoto);
  const busy = upload.busy || remove.busy;

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Let the same file be picked again after a failure.
    event.target.value = '';
    if (!file) return;

    setLocalError(null);
    if (file.size > MAX_MB * 1024 * 1024) {
      setLocalError(
        `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_MB} MB.`,
      );
      return;
    }
    if (!ACCEPTED.split(',').includes(file.type)) {
      setLocalError('Choose a JPEG, PNG or WebP image.');
      return;
    }

    const result = await upload.run(employeeId, file);
    if (result) {
      onChanged(result.photo_url);
      dispatch(showToast('Profile photo updated.', 'success'));
      if (isSelf) void dispatch(restoreSession());
    }
  };

  const handleRemove = async () => {
    const result = await remove.run(employeeId);
    if (result !== undefined) {
      onChanged(null);
      dispatch(showToast('Profile photo removed.', 'info'));
      if (isSelf) void dispatch(restoreSession());
    }
  };

  const errorMessage = localError ?? upload.error?.fieldErrors.photo ?? upload.error?.message;

  return (
    <Stack spacing={1.5} alignItems="center">
      <Box sx={{ position: 'relative' }}>
        <Avatar
          src={photoUrl ?? undefined}
          alt={fullName}
          sx={{
            width: 128,
            height: 128,
            fontSize: 40,
            fontWeight: 700,
            bgcolor: 'primary.main',
            border: 3,
            borderColor: 'background.paper',
            boxShadow: 2,
          }}
        >
          {initials(fullName)}
        </Avatar>

        {busy && (
          <CircularProgress
            size={136}
            thickness={2}
            sx={{ position: 'absolute', top: -4, left: -4 }}
          />
        )}

        {editable && (
          <Tooltip title={photoUrl ? 'Change photo' : 'Upload photo'}>
            <IconButton
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              aria-label={photoUrl ? 'Change profile photo' : 'Upload profile photo'}
              sx={{
                position: 'absolute',
                right: -4,
                bottom: -4,
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
                '&:hover': { bgcolor: 'primary.dark' },
              }}
            >
              <PhotoCameraIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {editable && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED}
            onChange={handleFile}
            hidden
            aria-hidden="true"
          />
          {photoUrl && (
            <Button
              size="small"
              color="inherit"
              startIcon={<DeleteIcon fontSize="small" />}
              onClick={handleRemove}
              disabled={busy}
            >
              Remove
            </Button>
          )}
          <Typography variant="caption" color="text.secondary" textAlign="center">
            JPEG, PNG or WebP · up to {MAX_MB} MB
          </Typography>
        </>
      )}

      {errorMessage && (
        <Alert
          severity="error"
          onClose={() => {
            setLocalError(null);
            upload.clearError();
          }}
          sx={{ width: '100%' }}
        >
          {errorMessage}
        </Alert>
      )}
    </Stack>
  );
}
