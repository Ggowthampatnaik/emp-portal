/**
 * Certificates and other paperwork on a profile.
 *
 * All of it is optional and none of it gates anything — the mandatory details
 * were taken during the profile wizard. This is the drawer people fill in
 * afterwards: mark sheets, degrees, experience letters, whatever HR asks for
 * later.
 *
 * The employee owns this section. They can attach and remove their own
 * documents; HR and Admin (`employee.edit`) can do the same on anyone's record.
 * Being able to attach one but not take it away again would make the whole
 * section unusable the first time somebody picks the wrong file.
 */

import AddIcon from '@mui/icons-material/Add';
import ArticleIcon from '@mui/icons-material/Article';
import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import FolderIcon from '@mui/icons-material/Folder';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useCallback, useState } from 'react';

import { useAppDispatch } from '@/app/hooks';
import SectionCard from '@/components/common/SectionCard';
import ShowMoreButton from '@/components/common/ShowMoreButton';
import ViewAllDialog from '@/components/common/ViewAllDialog';
import { ErrorAlert } from '@/components/common/Feedback';
import DocumentUploadDialog from '@/features/employees/DocumentUploadDialog';
import { showToast } from '@/features/ui/uiSlice';
import { useApiAction, useApiResource } from '@/hooks/useApiResource';
import { useShowMore } from '@/hooks/useShowMore';
import { employeesApi } from '@/services/api/services';
import { DOCUMENT_TYPES, documentTypeLabel } from '@/types/documents';
import type { EmployeeDocument } from '@/types/domain';

function readableSize(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** One attached file. */
function DocumentRow({
  row,
  canManage,
  busy,
  onRemove,
  /** Only under "Other", where the heading does not say what the file is. */
  showType = false,
}: {
  row: EmployeeDocument;
  canManage: boolean;
  busy: boolean;
  onRemove: (row: EmployeeDocument) => void;
  showType?: boolean;
}) {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      alignItems="center"
      sx={{ p: 1.25, border: 1, borderColor: 'divider', borderRadius: 1 }}
    >
      <ArticleIcon color="action" />
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Typography variant="body2" noWrap title={row.title}>
          {row.title}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {[readableSize(row.file_size), row.uploaded_by_name].filter(Boolean).join(' · ')}
        </Typography>
      </Box>

      {showType && <Chip size="small" label={documentTypeLabel(row.document_type)} />}

      {row.file_url && (
        <Tooltip title="Open">
          <IconButton
            size="small"
            component={Link}
            href={row.file_url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${row.title}`}
          >
            <DownloadIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      {canManage && (
        <Tooltip title="Remove">
          <IconButton
            size="small"
            onClick={() => onRemove(row)}
            disabled={busy}
            aria-label={`Remove ${row.title}`}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
    </Stack>
  );
}

/**
 * The rows under their category headings, in the order the categories are
 * asked for, so a half-complete set reads as a checklist rather than a pile.
 * A heading only appears while it has a row under it, which is what lets the
 * card show one document without printing five empty headings above it.
 */
function DocumentGroups({
  rows,
  canManage,
  busy,
  onRemove,
}: {
  rows: EmployeeDocument[];
  canManage: boolean;
  busy: boolean;
  onRemove: (row: EmployeeDocument) => void;
}) {
  const loose = rows.filter(
    (row) => !DOCUMENT_TYPES.some((type) => type.value === row.document_type),
  );

  return (
    <Stack spacing={2.5}>
      {DOCUMENT_TYPES.map((type) => {
        const inGroup = rows.filter((row) => row.document_type === type.value);
        if (inGroup.length === 0) return null;

        return (
          <Box key={type.value}>
            <Typography variant="overline" color="text.secondary">
              {type.label}
            </Typography>
            <Stack spacing={1} sx={{ mt: 0.5 }}>
              {inGroup.map((row) => (
                <DocumentRow
                  key={row.id}
                  row={row}
                  canManage={canManage}
                  busy={busy}
                  onRemove={onRemove}
                />
              ))}
            </Stack>
          </Box>
        );
      })}

      {/* Anything stored under a type this screen does not list - legacy rows
          from before the categories were split out. Shown rather than hidden,
          because a document nobody can see is a document nobody can replace. */}
      {loose.length > 0 && (
        <Box>
          <Typography variant="overline" color="text.secondary">
            Other
          </Typography>
          <Stack spacing={1} sx={{ mt: 0.5 }}>
            {loose.map((row) => (
              <DocumentRow
                key={row.id}
                row={row}
                canManage={canManage}
                busy={busy}
                onRemove={onRemove}
                showType
              />
            ))}
          </Stack>
        </Box>
      )}
    </Stack>
  );
}

export default function DocumentsCard({
  employeeId,
  canManage,
}: {
  employeeId: number;
  /** True for the record's owner and for anyone holding `employee.edit`. */
  canManage: boolean;
}) {
  const dispatch = useAppDispatch();
  const [adding, setAdding] = useState(false);

  const { data, loading, error, reload } = useApiResource(
    useCallback(() => employeesApi.documents(employeeId), [employeeId]),
    [employeeId],
  );

  const remove = useApiAction(async (documentId: number) => {
    await employeesApi.removeDocument(employeeId, documentId);
    // A 204 resolves nothing; `run` also resolves nothing when it fails.
    return true as const;
  });

  const handleRemove = async (document: EmployeeDocument) => {
    const done = await remove.run(document.id);
    if (!done) return;
    dispatch(showToast(`${document.title} removed.`, 'success'));
    reload();
  };

  const documents = data ?? [];

  /**
   * The rows in the order the groups below print them, so capping the list
   * takes them off the end rather than out of the middle of a category. The
   * groups then render from `shown`, which keeps the headings honest: a
   * category only appears while it still has a row on screen.
   */
  const ordered = [
    ...DOCUMENT_TYPES.flatMap((type) =>
      documents.filter((row) => row.document_type === type.value),
    ),
    ...documents.filter(
      (row) => !DOCUMENT_TYPES.some((type) => type.value === row.document_type),
    ),
  ];
  const more = useShowMore(ordered);
  const shown = more.visible;

  return (
    <SectionCard
      title="Documents"
      icon={<FolderIcon color="primary" />}
      subtitle="Mark sheets, degrees, experience letters and anything else asked for. All optional."
      count={documents.length}
      footer={<ShowMoreButton hidden={more.hidden} onClick={more.show} noun="documents" />}
      action={
        canManage ? (
          <Button size="small" startIcon={<AddIcon />} onClick={() => setAdding(true)}>
            Add document
          </Button>
        ) : undefined
      }
    >
      {loading && <LinearProgress />}
      {error && <ErrorAlert error={error} onRetry={reload} />}
      {remove.error && <ErrorAlert error={remove.error} />}

      {!loading && !error && documents.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          {canManage
            ? 'Nothing attached yet. Use "Add document" for a mark sheet, degree certificate or experience letter.'
            : 'No documents have been attached to this record.'}
        </Typography>
      )}

      <DocumentGroups
        rows={shown}
        canManage={canManage}
        busy={remove.busy}
        onRemove={handleRemove}
      />

      <ViewAllDialog
        open={more.open}
        onClose={more.close}
        title={`Documents · ${documents.length} file${documents.length === 1 ? '' : 's'}`}
      >
        <DocumentGroups
          rows={ordered}
          canManage={canManage}
          busy={remove.busy}
          onRemove={handleRemove}
        />
      </ViewAllDialog>

      {adding && (
        <DocumentUploadDialog
          employeeId={employeeId}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            reload();
          }}
        />
      )}
    </SectionCard>
  );
}
