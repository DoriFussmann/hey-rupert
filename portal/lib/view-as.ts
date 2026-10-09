import "server-only";
import { cookies } from "next/headers";

// "View as client": an admin-only, short-lived cookie naming the client whose
// portal the admin is previewing. It is only honoured for admin sessions.
export const VIEW_AS_COOKIE = "rupert_view_as";
export const VIEW_AS_MAX_AGE_SECONDS = 60 * 60 * 8;

const CLIENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isClientId(value: string | null | undefined): value is string {
  return Boolean(value && CLIENT_ID_PATTERN.test(value));
}

export function readViewAsClientId() {
  const value = cookies().get(VIEW_AS_COOKIE)?.value;
  return isClientId(value) ? value : null;
}
