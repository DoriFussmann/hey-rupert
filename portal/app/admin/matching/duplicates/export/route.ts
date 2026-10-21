import { NextResponse, type NextRequest } from "next/server";

/** The duplicate report moved to Taxonomy. */
export function GET(request: NextRequest) {
  return NextResponse.redirect(new URL("/admin/taxonomy/duplicates/export", request.url));
}
