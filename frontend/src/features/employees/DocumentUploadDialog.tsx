/**
 * Attach one document to a profile.
 *
 * PDFs only. The picker below and the `accept` attribute are a courtesy — the
 * server checks the file's first bytes, because a browser's file type is
 * whatever the caller says it is. Refusing here as well just means the message
 * arrives before the upload rather than after it.
 *
 * The name defaults to the category so the common case is two clicks and a
 * file — nobody wants to type "10th certificate" into a box directly under a
 * dropdown that already says it.
 */

import UploadFileIcon from '@mui/icons-material/UploadFile';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import MenuItem from '@mui/material/MenuItem';
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
import { DOCUMENT_TYPES } from '@/types/documents';

const MAX_MB = 10;
/** Matched to the server, which enforces it on the bytes rather than the name. */
const ACCEPTED = 'application/pdf,.pdf';

export default function DocumentUploadDialog({
  employeeId,
  onClose,
  onSaved,
}: {
  employeeId: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dispatch = useAppDispatch();
  const fileRef = useRef<HTMLInputElement>(null);

  const [type, setType] = useState(DOCUMENT_TYPES[0].value);
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const upload = useApiAction((form: FormData) =>
    employeesApi.uploadDocument(employeeId, form),
  );

  const category = DOCUMENT_TYPES.find((option) => option.value === type);

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0];
    event.target.value = '';
    if (!chosen) return;
    if (!chosen.name.toLowerCase().endsWith('.pdf')) {
      setFileError('Documents must be PDFs. Export or scan the file as a PDF first.');
      return;
    }
    if (chosen.size > MAX_MB * 1024 * 1024) {
      setFileError(`Choose a file under ${MAX_MB} MB.`);
      return;
    }
    setFileError(null);
    setFile(chosen);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!file) return;

    const form = new FormData();
    form.append('document_type', type);
    // The category is a perfectly good name when nobody typed one.
    form.append('title', title.trim() || (category?.label ?? 'Document'));
    form.append('file', file);

    const saved = await upload.run(form);
    if (!saved) return;
    dispatch(showToast(`${saved.title} attached.`, 'success'));
    onSaved();
  };

  return (
    <Dialog open onClose={upload.busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <ClosableDialogTitle
        onClose={onClose}
        disabled={upload.busy}
        subtitle="PDF only. Optional - nothing here holds up your access to the portal."
      >
        Add document
      </ClosableDialogTitle>

      <Box component="form" onSubmit={handleSubmit} noValidate>
        <DialogContent dividers>
          <Stack spacing={2}>
            {upload.error && <ErrorAlert error={upload.error} />}

            <TextField
              select
              label="Document type"
              value={type}
              onChange={(event) => setType(event.target.value)}
              helperText={category?.hint ?? ' '}
              disabled={upload.busy}
              fullWidth
            >
              {DOCUMENT_TYPES.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              label="Document name"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={category?.label}
              helperText={
                upload.fieldErrors.title ??
                `What to call it in your profile. Leave blank for "${category?.label}".`
              }
              error={Boolean(upload.fieldErrors.title)}
              disabled={upload.busy}
              fullWidth
            />

            <Stack direction="row" spacing={2} alignItems="center">
              <Button
                variant="outlined"
                startIcon={<UploadFileIcon />}
                onClick={() => fileRef.current?.click()}
                disabled={upload.busy}
              >
                {file ? 'Choose a different file' : 'Choose file'}
              </Button>
              <Typography variant="body2" color="text.secondary" noWrap sx={{ minWidth: 0 }}>
                {file ? file.name : `PDF only, under ${MAX_MB} MB.`}
              </Typography>
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPTED}
                onChange={handleFile}
                hidden
                aria-label="Document file"
              />
            </Stack>

            {fileError && <Alert severity="error">{fileError}</Alert>}
            {touched && !file && !fileError && (
              <Alert severity="warning">Choose a file to attach.</Alert>
            )}
            {upload.fieldErrors.file && (
              <Alert severity="error">{upload.fieldErrors.file}</Alert>
            )}
          </Stack>
        </DialogContent>

        <DialogActions>
          <Button onClick={onClose} disabled={upload.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={upload.busy}>
            {upload.busy ? 'Uploading...' : 'Attach'}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
