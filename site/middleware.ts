import { NextResponse, type NextRequest } from "next/server";
import { applySecurityHeaders } from "./lib/http-security.ts";

export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  applySecurityHeaders(response.headers, new URL(request.url));
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
