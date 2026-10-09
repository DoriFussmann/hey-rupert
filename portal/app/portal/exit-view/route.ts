import { NextResponse, type NextRequest } from "next/server";
import { VIEW_AS_COOKIE, isClientId } from "@/lib/view-as";

// Ends "view as client" and returns the admin to that client's page.
export function GET(request: NextRequest) {
  const clientId = request.cookies.get(VIEW_AS_COOKIE)?.value;
  const target = isClientId(clientId) ? `/admin/clients/${clientId}` : "/admin";

  const response = NextResponse.redirect(new URL(target, request.url));
  response.cookies.delete(VIEW_AS_COOKIE);
  return response;
}
