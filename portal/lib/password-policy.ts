export const MIN_PASSWORD_LENGTH = 8;

export const SETUP_LINK_UNAVAILABLE_MESSAGE =
  "This link has expired or was already used. Contact Dori for a new link.";

// Shared by the set-password form and its server action. Returns an error
// message, or null when the password is acceptable.
export function validateNewPassword(
  password: string,
  confirm: string,
): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password !== confirm) {
    return "Passwords do not match.";
  }
  return null;
}
