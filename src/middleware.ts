import { NextRequest, NextResponse } from "next/server";

const ALLOWED_ORIGINS = [
  "https://billybob36.github.io",
  "http://localhost:3000",
  "http://localhost:3001",
];

const PUBLIC_PATHS = ["/login", "/api/auth"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // --- Auth check (skip public paths + static assets) ---
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  const isStatic = pathname.startsWith("/_next") || pathname.startsWith("/favicon");

  if (!isPublic && !isStatic) {
    const session = request.cookies.get("serres_session")?.value;
    if (!session) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    // Basic validation: try to decode
    try {
      const decoded = JSON.parse(Buffer.from(session, "base64").toString());
      if (!decoded.id || !decoded.username) {
        return NextResponse.redirect(new URL("/login", request.url));
      }
    } catch {
      return NextResponse.redirect(new URL("/login", request.url));
    }
  }

  // --- CORS for API routes ---
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const origin = request.headers.get("origin") || "";
  const isAllowed = ALLOWED_ORIGINS.includes(origin) || !origin;

  // Handle preflight OPTIONS requests
  if (request.method === "OPTIONS") {
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": isAllowed ? origin : "",
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  const response = NextResponse.next();

  if (isAllowed && origin) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
