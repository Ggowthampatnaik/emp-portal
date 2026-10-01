/**
 * Issue an asset, or amend one already issued.
 *
 * One dialog for both, because the fields are identical and the only
 * difference is whether there is an id to PATCH. The photo is optional and
 * replaces rather than accumulates — an asset has one picture of itself.
 */

import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Avatar from '@mui/material/Avatar';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import MenuItem from '@mui/material/MenuItem';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';

import { useAppDispatch } from '@/app/hooks';
import ClosableDialogTitle from '@/components/common/ClosableDialogTitle';
import { ErrorAlert } from '@/components/common/Feedback';
import { showToast } from '@/features/ui/uiSlice';
import { useApiAction } from '@/hooks/useApiResource';
import { employeesApi } from '@/services/api/services';
import { ASSET_CONDITION_LABELS } from '@/types/domain';
import type { AssetCondition, EmployeeAsset } from '@/types/domain';

/** Matched to the server's own limits, so the message arrives before the upload does. */
const MAX_MB = 5;
const ACCEPTED = 'image/jpeg,image/png,image/webp';

interface Props {
  employeeId: number;
  /** Null when issuing something new. */
  asset: EmployeeAsset | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function AssetDialog({ employeeId, asset, onClose, onSaved }: Props) {
  const dispatch = useAppDispatch();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(asset?.name ?? '');
  const [brand, setBrand] = useState(asset?.brand ?? '');
  const [serial, setSerial] = useState(asset?.serial_number ?? '');
  const [issuedOn, setIssuedOn] = useState(asset?.issued_on ?? '');
  const [condition, setCondition] = useState<AssetCondition>(asset?.condition ?? 'good');
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(asset?.photo_url ?? null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const save = useApiAction((form: FormData) =>
    asset
      ? employeesApi.updateAsset(employeeId, asset.id, form)
      : employeesApi.addAsset(employeeId, form),
  );

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0];
    event.target.value = '';
    if (!chosen) return;

    if (chosen.size > MAX_MB * 1024 * 1024) {
      setPhotoError(`Choose an image under ${MAX_MB} MB.`);
      return;
    }
    setPhotoError(null);
    setPhoto(chosen);
    setPreview(URL.createObjectURL(chosen));
  };

  // A blank serial is allowed when a photo rides along: the server reads the
  // barcode on the label and fills the number in itself. It stays required
  // when there is neither a typed serial nor a photo to read one from.
  const serialMissing = !serial.trim() && !photo && !asset;
  const missing = {
    name: touched && !name.trim(),
    brand: touched && !brand.trim(),
    serial: touched && serialMissing,
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!name.trim() || !brand.trim() || serialMissing) return;

    const form = new FormData();
    form.append('name', name.trim());
    form.append('brand', brand.trim());
    // Left out when blank so the server may fill it from the photo's barcode.
    if (serial.trim()) form.append('serial_number', serial.trim());
    if (issuedOn) form.append('issued_on', issuedOn);
    form.append('condition', condition);
    // Only sent when a new file was chosen, so amending the brand does not
    // clear the picture already on the record.
    if (photo) form.append('photo', photo);

    const saved = await save.run(form);
    if (!saved) return;

    if (saved.barcode_serial && !serial.trim()) {
      dispatch(
        showToast(
          `Asset number ${saved.serial_number} read from the barcode photo.`,
          'success',
        ),
      );
    } else if (saved.barcode_serial && saved.barcode_serial !== saved.serial_number) {
      dispatch(
        showToast(
          `Saved with ${saved.serial_number}. The photo's barcode reads ` +
            `${saved.barcode_serial} - worth a second look.`,
          'warning',
        ),
      );
    } else {
      dispatch(
        showToast(asset ? `${saved.name} updated.` : `${saved.name} issued.`, 'success'),
      );
    }
    onSaved();
  };

  return (
    <Dialog open onClose={save.busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <ClosableDialogTitle
        onClose={onClose}
        disabled={save.busy}
        subtitle={
          asset
            ? 'Correct the details recorded against this item.'
            : 'Record a new item of kit.'
        }
      >
        {asset ? 'Edit asset' : 'Issue asset'}
      </ClosableDialogTitle>

      <Box component="form" onSubmit={handleSubmit} noValidate>
        <DialogContent dividers>
          <Stack spacing={2}>
            {save.error && <ErrorAlert error={save.error} />}

            <TextField
              label="Name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              error={missing.name || Boolean(save.fieldErrors.name)}
              helperText={
                save.fieldErrors.name ??
                (missing.name ? 'What is it? e.g. MacBook Pro 14' : ' ')
              }
              disabled={save.busy}
              autoFocus
              fullWidth
            />

            <TextField
              label="Brand"
              value={brand}
              onChange={(event) => setBrand(event.target.value)}
              error={missing.brand || Boolean(save.fieldErrors.brand)}
              helperText={
                save.fieldErrors.brand ?? (missing.brand ? 'Who made it? e.g. Apple' : ' ')
              }
              disabled={save.busy}
              fullWidth
            />

            <TextField
              label="Serial number"
              value={serial}
              onChange={(event) => setSerial(event.target.value)}
              error={missing.serial || Boolean(save.fieldErrors.serial_number)}
              helperText={
                save.fieldErrors.serial_number ??
                (missing.serial
                  ? 'Type the serial, or attach a photo of the barcode label instead.'
                  : 'Leave blank and attach a photo of the barcode label - the number is read from it.')
              }
              disabled={save.busy}
              slotProps={{ htmlInput: { style: { fontFamily: 'monospace' } } }}
              fullWidth
            />

            <Stack direction="row" spacing={2}>
              <TextField
                label="Issued on"
                type="date"
                value={issuedOn}
                onChange={(event) => setIssuedOn(event.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                error={Boolean(save.fieldErrors.issued_on)}
                helperText={save.fieldErrors.issued_on ?? ' '}
                disabled={save.busy}
                fullWidth
              />
              <TextField
                select
                label="Condition"
                value={condition}
                onChange={(event) => setCondition(event.target.value as AssetCondition)}
                helperText=" "
                disabled={save.busy}
                fullWidth
              >
                {Object.entries(ASSET_CONDITION_LABELS).map(([value, label]) => (
                  <MenuItem key={value} value={value}>
                    {label}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>

            <Stack direction="row" spacing={2} alignItems="center">
              <Avatar
                variant="rounded"
                src={preview ?? undefined}
                alt=""
                sx={{ width: 72, height: 72, bgcolor: 'action.hover' }}
              >
                <PhotoCameraIcon />
              </Avatar>
              <Stack spacing={0.5} alignItems="flex-start">
                <Button
                  size="small"
                  startIcon={<PhotoCameraIcon />}
                  onClick={() => fileRef.current?.click()}
                  disabled={save.busy}
                >
                  {preview ? 'Change photo' : 'Add photo'}
                </Button>
                <Typography variant="caption" color="text.secondary">
                  JPEG, PNG or WebP, under {MAX_MB} MB. Photograph the barcode label on the back
                  and the asset number fills itself in.
                </Typography>
              </Stack>
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPTED}
                onChange={handleFile}
                hidden
                aria-label="Asset photo"
              />
            </Stack>

            {photoError && <Alert severity="error">{photoError}</Alert>}
          </Stack>
        </DialogContent>

        <DialogActions>
          <Button onClick={onClose} disabled={save.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={save.busy}>
            {save.busy ? 'Saving...' : asset ? 'Save changes' : 'Issue asset'}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
