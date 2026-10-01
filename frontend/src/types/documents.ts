/**
 * The document categories a profile can hold.
 *
 * Listed in the order they are asked for — school, then college, then
 * certifications, then work — so a half-filled set reads as a checklist. The
 * values match `EmployeeDocument.DocumentType` on the server; the two legacy
 * buckets (`education`, `experience`) are not offered for new uploads but are
 * still labelled, because rows recorded under them predate the split.
 */

export interface DocumentCategory {
  value: string;
  label: string;
  /** What to expect in this slot, shown under the picker. */
  hint?: string;
}

export const DOCUMENT_TYPES: DocumentCategory[] = [
  {
    value: 'tenth',
    label: '10th certificate',
    hint: 'Class 10 certificate or marks statement.',
  },
  {
    value: 'intermediate',
    label: '12th certificate',
    hint: 'Class 12, intermediate or diploma certificate.',
  },
  {
    value: 'bachelors',
    label: "Bachelor's certificate",
    hint: 'Degree certificate or consolidated marks.',
  },
  {
    value: 'masters',
    label: "Master's certificate",
    hint: 'Post-graduate certificate or marks.',
  },
  {
    value: 'skill_certificate',
    label: 'Skills certification',
    hint: 'AWS, Azure, Scrum, a language certificate - anything you have qualified in.',
  },
  {
    value: 'other_education',
    label: 'Other educational document',
    hint: 'Anything else studied that does not fit above.',
  },
  {
    value: 'experience_letter',
    label: 'Experience document',
    hint: 'Relieving letter, service certificate or a previous employer payslip.',
  },
  { value: 'id_proof', label: 'ID proof', hint: 'Aadhaar, passport, PAN or driving licence.' },
  { value: 'address_proof', label: 'Address proof' },
  { value: 'contract', label: 'Employment contract' },
  { value: 'other', label: 'Other relevant document' },
];

/** Labels for anything stored under a legacy type, so nothing renders as a slug. */
const LEGACY_LABELS: Record<string, string> = {
  education: 'Education certificate',
  experience: 'Experience letter',
};

export function documentTypeLabel(value: string): string {
  return (
    DOCUMENT_TYPES.find((type) => type.value === value)?.label ?? LEGACY_LABELS[value] ?? value
  );
}
