export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PROFILE_ID_REGEX = /^[a-z0-9_-]+$/i;
export const SSH_ALIAS_REGEX = /^[a-zA-Z0-9._-]+$/;

export function validateEmail(val: string): string | undefined {
  if (!val.trim()) return "Required";
  if (!EMAIL_REGEX.test(val)) return "Invalid email";
  return undefined;
}

export function validateProfileId(val: string): string | undefined {
  if (!val.trim()) return "Required";
  if (/\s/.test(val)) return "No spaces allowed";
  if (!PROFILE_ID_REGEX.test(val)) return "Only letters, numbers, hyphens, underscores";
  return undefined;
}

export function validateSSHAlias(val: string): string | undefined {
  if (!val.trim()) return "Required";
  if (!SSH_ALIAS_REGEX.test(val)) return "Only letters, numbers, dots, hyphens, underscores";
  return undefined;
}
