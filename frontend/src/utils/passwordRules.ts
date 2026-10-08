/**
 * The portal's password rule, checked as the person types. The server enforces
 * the same rule (backend/common/password_validation.py plus Django's minimum
 * length) - keep the two in step.
 */

export interface PasswordRule {
  /** How the rule reads when it is the thing still missing. */
  missing: string;
  test: (password: string) => boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
  { missing: 'at least 8 characters', test: (p) => p.length >= 8 },
  { missing: 'an uppercase letter', test: (p) => /\p{Lu}/u.test(p) },
  { missing: 'a lowercase letter', test: (p) => /\p{Ll}/u.test(p) },
  { missing: 'a number', test: (p) => /\p{Nd}/u.test(p) },
  // Anything that is not a letter, a digit or a space: @ # $ % & ! and so on.
  { missing: 'a special character (@ # $ % & !)', test: (p) => /[^\p{L}\p{N}\s]/u.test(p) },
];

/** The one-line rule shown under the field before anything is typed. */
export const PASSWORD_HINT =
  'At least 8 characters, with an uppercase letter, a lowercase letter, a number and a special character (@ # $ % & !).';

export const missingPasswordRules = (password: string): string[] =>
  PASSWORD_RULES.filter((rule) => !rule.test(password)).map((rule) => rule.missing);

export const meetsPasswordRules = (password: string): boolean =>
  missingPasswordRules(password).length === 0;

/** "Add a number and a special character (…)." - or null when nothing is missing. */
export const describeMissing = (password: string): string | null => {
  const missing = missingPasswordRules(password);
  if (missing.length === 0) return null;
  const list =
    missing.length === 1
      ? missing[0]
      : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`;
  return `Add ${list}.`;
};
