import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { getAdminClient } from "@/lib/data";
import {
  VIEW_AS_COOKIE,
  VIEW_AS_MAX_AGE_SECONDS,
  isClientId,
} from "@/lib/view-as";

// Starts a read-only "view as client" session and opens the client's portal.
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const client = isClientId(params.id) ? await getAdminClient(params.id) : null;
  if (!client) {
    return NextResponse.redirect(new URL("/admin", request.url));
  }

  const response = NextResponse.redirect(
    new URL("/portal/onboarding", request.url),
  );
  response.cookies.set(VIEW_AS_COOKIE, client.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: VIEW_AS_MAX_AGE_SECONDS,
  });
  return response;
}
