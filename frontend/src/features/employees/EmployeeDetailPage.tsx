/**
 * Employee profile. Doubles as "My profile" - when no id is in the route it
 * loads /employees/me/. What is editable depends on the caller: HR/Admin may
 * change employment fields, an employee only their own contact details.
 */

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import BadgeIcon from '@mui/icons-material/Badge';
import ContactPhoneIcon from '@mui/icons-material/ContactPhone';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useAppDispatch } from '@/app/hooks';
import { ErrorAlert } from '@/components/common/Feedback';
import PageHeader from '@/components/common/PageHeader';
import SectionCard from '@/components/common/SectionCard';
import StatusChip from '@/components/common/StatusChip';
import { showToast } from '@/features/ui/uiSlice';
import { usePermissions } from '@/hooks/usePermissions';
import { useApiAction, useApiResource } from '@/hooks/useApiResource';
import AssetsCard from '@/features/employees/AssetsCard';
import BankDetailsCard from '@/features/employees/BankDetailsCard';
import DocumentsCard from '@/features/employees/DocumentsCard';
import ExperienceCard from '@/features/employees/ExperienceCard';
import DeleteProfileCard from '@/features/employees/DeleteProfileCard';
import ProfilePhoto from '@/features/employees/ProfilePhoto';
import SkillsCard from '@/features/employees/SkillsCard';
import { employeesApi } from '@/services/api/services';
import { ROLES } from '@/types/auth';
import { BLOOD_GROUPS, type EmployeeDetail } from '@/types/domain';
import { formatDate } from '@/utils/date';

const SELF_FIELDS = [
  'phone',
  'blood_group',
  'permanent_address',
  'current_address',
  'date_of_birth',
  'gender',
  'emergency_contact_name',
  'emergency_contact_phone',
] as const;

const GENDERS = [
  { value: '', label: 'Not specified' },
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'other', label: 'Other' },
  { value: 'undisclosed', label: 'Prefer not to say' },
];

/** `female` -> `Female`. The API stores enum slugs; a profile should not read like one. */
function titleCase(
  value: string | number | null | undefined,
): string | number | null | undefined {
  if (typeof value !== 'string' || !value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' ');
}

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2">{value || '-'}</Typography>
    </Box>
  );
}

export default function EmployeeDetailPage({ self = false }: { self?: boolean }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { can, user, roles, isSuperAdmin } = usePermissions();

  const fetcher = useCallback(
    () => (self || !id ? employeesApi.me() : employeesApi.detail(id)),
    [self, id],
  );
  const { data, loading, error, reload, setData } = useApiResource(fetcher, [self, id]);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<EmployeeDetail>>({});
  const update = useApiAction(employeesApi.update);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const isOwnRecord = Boolean(data && user && data.email === user.email);
  const canEditAll = can('employee.edit');
  const canEdit = canEditAll || isOwnRecord;
  /**
   * How much of a record an oversight module shows.
   *
   * Super Admin and Admin open this page to see who works here and who reports
   * to whom. The rest of a record - what someone can be staffed on, where they
   * worked before, their certificates and where their salary is paid - belongs
   * to the roles that maintain it, which is HR and the person themselves.
   *
   * `self` is the My profile route: a person looking at their own data rather
   * than at the module, so it always shows everything.
   */
  const oversightOnly = !self && (isSuperAdmin || roles.includes(ROLES.ADMIN));
  const showPersonalRecords = !oversightOnly;
  /**
   * Assets are the exception. Issuing and taking back equipment is Admin's job
   * (`asset.manage`), so their module keeps the register even though the rest
   * of the record is trimmed. Super Admin holds no operational job at all, so
   * theirs does not.
   */
  const showAssets = !oversightOnly || !isSuperAdmin;

  const departments = useApiResource(
    useCallback(
      () => (canEditAll ? employeesApi.departments({ page_size: 100 }) : Promise.resolve(null)),
      [canEditAll],
    ),
    [canEditAll],
  );
  const designations = useApiResource(
    useCallback(
      () =>
        canEditAll ? employeesApi.designations({ page_size: 100 }) : Promise.resolve(null),
      [canEditAll],
    ),
    [canEditAll],
  );

  const set = (field: keyof EmployeeDetail) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [field]: event.target.value }));

  const handleSave = async () => {
    if (!data) return;

    const payload: Record<string, unknown> = {};
    const editable = canEditAll
      ? ([
          ...SELF_FIELDS,
          'department',
          'designation',
          'reporting_manager',
          'employment_status',
          'work_location',
          'employee_code',
          'first_name',
          'last_name',
          'date_of_joining',
        ] as const)
      : SELF_FIELDS;

    for (const field of editable) {
      const next = form[field as keyof EmployeeDetail];
      if (next !== data[field as keyof EmployeeDetail]) {
        payload[field] = next === '' ? null : next;
      }
    }

    if (Object.keys(payload).length === 0) {
      setEditing(false);
      return;
    }

    const saved = await update.run(data.id, payload);
    if (saved) {
      setData(saved);
      setEditing(false);
      dispatch(showToast('Profile updated.', 'success'));
    }
  };

  if (loading) return <LinearProgress />;
  if (error) return <ErrorAlert error={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <>
      <PageHeader
        title={self ? 'My profile' : data.full_name}
        subtitle={`${data.employee_code} · ${data.designation_name ?? 'No designation'} · ${
          data.department_name ?? 'No department'
        }`}
        actions={
          <Stack direction="row" spacing={1}>
            {!self && (
              <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/employees')}>
                Back
              </Button>
            )}
            {canEdit && !editing && (
              <Button
                startIcon={<EditIcon />}
                variant="contained"
                onClick={() => setEditing(true)}
              >
                Edit
              </Button>
            )}
            {editing && (
              <>
                <Button
                  onClick={() => {
                    setEditing(false);
                    setForm(data);
                    update.clearError();
                  }}
                >
                  Cancel
                </Button>
                <Button
                  startIcon={<SaveIcon />}
                  variant="contained"
                  onClick={handleSave}
                  disabled={update.busy}
                >
                  {update.busy ? 'Saving...' : 'Save'}
                </Button>
              </>
            )}
          </Stack>
        }
      />

      {update.error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={update.clearError}>
          {update.error.message}
          {Object.entries(update.fieldErrors).map(([field, message]) => (
            <div key={field}>
              <strong>{field}:</strong> {message}
            </div>
          ))}
        </Alert>
      )}

      {!canEditAll && isOwnRecord && editing && (
        <Alert severity="info" sx={{ mb: 2 }}>
          You can update your contact and personal details. Employment details are maintained by
          HR.
        </Alert>
      )}

      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
          // Stretch, which is what `SectionCard` is built for: it fills its
          // cell and pins its footer, so a row comes out one height with the
          // "View more" buttons on one line.
          //
          // This was `start` for a while, because the list cards had no bound -
          // Documents with nine rows beside Skills with one made stretching
          // leave a void, and sizing each card to its content was the lesser
          // evil. Now every list card shows a few rows and holds the rest
          // behind a button, so the heights are close and stretch is the
          // tidier of the two again: level bottoms rather than ragged gaps.
        }}
      >
        <SectionCard
          title="Employment"
          icon={<BadgeIcon color="primary" />}
          subtitle="Role, reporting line and joining details."
          header={
            <ProfilePhoto
              employeeId={data.id}
              fullName={data.full_name}
              photoUrl={data.photo_url}
              editable={canEdit}
              isSelf={isOwnRecord}
              onChanged={(photo_url) => setData({ ...data, photo_url })}
            />
          }
        >
          <Stack spacing={2}>
            {editing && canEditAll ? (
              <>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    label="First name"
                    value={form.first_name ?? ''}
                    onChange={set('first_name')}
                    fullWidth
                    size="small"
                  />
                  <TextField
                    label="Last name"
                    value={form.last_name ?? ''}
                    onChange={set('last_name')}
                    fullWidth
                    size="small"
                  />
                </Stack>
                <TextField
                  select
                  label="Department"
                  value={form.department ?? ''}
                  onChange={set('department')}
                  size="small"
                >
                  <MenuItem value="">Not assigned</MenuItem>
                  {(departments.data?.results ?? []).map((row) => (
                    <MenuItem key={row.id} value={row.id}>
                      {row.name}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  label="Designation"
                  value={form.designation ?? ''}
                  onChange={set('designation')}
                  size="small"
                >
                  <MenuItem value="">Not assigned</MenuItem>
                  {(designations.data?.results ?? []).map((row) => (
                    <MenuItem key={row.id} value={row.id}>
                      {row.name}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  label="Employment status"
                  value={form.employment_status ?? 'active'}
                  onChange={set('employment_status')}
                  size="small"
                >
                  <MenuItem value="active">Active</MenuItem>
                  <MenuItem value="on_notice">On notice</MenuItem>
                  <MenuItem value="inactive">Inactive</MenuItem>
                </TextField>
                <TextField
                  label="Work location"
                  value={form.work_location ?? ''}
                  onChange={set('work_location')}
                  size="small"
                />
              </>
            ) : (
              <>
                <Stack direction="row" spacing={1} alignItems="center">
                  <StatusChip status={data.employment_status} />
                  {data.roles.map((role) => (
                    <Chip key={role} size="small" variant="outlined" label={role} />
                  ))}
                </Stack>
                <Field label="Employee ID" value={data.employee_code} />
                <Field label="Email" value={data.email} />
                <Field label="Department" value={data.department_name} />
                <Field label="Designation" value={data.designation_name} />
                <Field label="Reporting manager" value={data.reporting_manager_name} />
                <Field label="Direct reports" value={data.direct_report_count} />
                <Field label="Date of joining" value={formatDate(data.date_of_joining)} />
                <Field label="Work location" value={data.work_location} />
              </>
            )}
          </Stack>
        </SectionCard>

        <SectionCard
          title="Personal & contact"
          icon={<ContactPhoneIcon color="primary" />}
          subtitle="How to reach you, and who to call in an emergency."
        >
          <Stack spacing={2}>
            {editing ? (
              <>
                <TextField
                  label="Phone"
                  value={form.phone ?? ''}
                  onChange={set('phone')}
                  size="small"
                  error={Boolean(update.fieldErrors.phone)}
                  helperText={update.fieldErrors.phone ?? ' '}
                />
                <TextField
                  label="Date of birth"
                  type="date"
                  value={form.date_of_birth ?? ''}
                  onChange={set('date_of_birth')}
                  size="small"
                  slotProps={{ inputLabel: { shrink: true } }}
                />
                <TextField
                  select
                  label="Gender"
                  value={form.gender ?? ''}
                  onChange={set('gender')}
                  size="small"
                >
                  {GENDERS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  label="Blood group"
                  value={form.blood_group ?? ''}
                  onChange={set('blood_group')}
                  size="small"
                  error={Boolean(update.fieldErrors.blood_group)}
                  helperText={update.fieldErrors.blood_group ?? 'Used for emergencies only.'}
                >
                  <MenuItem value="">Not specified</MenuItem>
                  {BLOOD_GROUPS.map((group) => (
                    <MenuItem key={group} value={group}>
                      {group}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  label="Permanent address"
                  value={form.permanent_address ?? ''}
                  onChange={set('permanent_address')}
                  size="small"
                  multiline
                  minRows={2}
                  helperText="Address of record, used for statutory paperwork."
                />
                <TextField
                  label="Current address"
                  value={form.current_address ?? ''}
                  onChange={set('current_address')}
                  size="small"
                  multiline
                  minRows={2}
                  helperText="Where you live now, if different."
                />
                <Divider />
                <TextField
                  label="Emergency contact name"
                  value={form.emergency_contact_name ?? ''}
                  onChange={set('emergency_contact_name')}
                  size="small"
                />
                <TextField
                  label="Emergency contact phone"
                  value={form.emergency_contact_phone ?? ''}
                  onChange={set('emergency_contact_phone')}
                  size="small"
                />
              </>
            ) : (
              <>
                <Field label="Phone" value={data.phone} />
                <Field label="Date of birth" value={formatDate(data.date_of_birth)} />
                <Field label="Gender" value={titleCase(data.gender)} />
                <Field label="Blood group" value={data.blood_group} />
                <Field label="Permanent address" value={data.permanent_address} />
                <Field label="Current address" value={data.current_address} />
                <Divider />
                <Field label="Emergency contact" value={data.emergency_contact_name} />
                <Field label="Emergency phone" value={data.emergency_contact_phone} />
              </>
            )}
          </Stack>
        </SectionCard>

        {/* Staffing, paperwork and pay belong to the roles that maintain them -
            HR and the person themselves. An oversight module stops at the
            employment and contact panels above. */}
        {showPersonalRecords && (
          <>
            <SkillsCard employeeId={data.id} canEdit={canEdit} />

            <ExperienceCard employeeId={data.id} canEdit={canEdit} />

            {/* The optional drawer: certificates and letters the employee adds
                after onboarding. Theirs to maintain, and HR's on anyone's record. */}
            <DocumentsCard employeeId={data.id} canManage={canEdit} />
          </>
        )}

        {/* Kept for Admin, whose job this is, and dropped for Super Admin. */}
        {showAssets && <AssetsCard employeeId={data.id} canManage={can('asset.manage')} />}

        {showPersonalRecords && (
          <BankDetailsCard
            employeeId={data.id}
            employeeName={data.full_name}
            isOwner={isOwnRecord}
            canManage={can('bank.manage')}
          />
        )}

        <DeleteProfileCard
          employeeId={data.id}
          employeeName={data.full_name}
          isActive={data.employment_status === 'active'}
          isOwnRecord={isOwnRecord}
          canRequest={can('employee.request_deletion')}
        />
      </Box>
    </>
  );
}
