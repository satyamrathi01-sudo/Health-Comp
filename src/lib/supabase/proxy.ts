import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = [
  "/login",
  "/auth",
  "/api/health",
  // Next serves these generated metadata routes WITHOUT a file extension
  // (e.g. /apple-icon?fe5d8954), so the matcher's extension exclusion misses
  // them. Left unlisted, iOS "Add to Home Screen" fetches the icon, gets
  // redirected, and saves an HTML login page as the app icon.
  "/icon",
  "/apple-icon",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Before .env.local is filled in, let every request through rather than
  // throwing an opaque 500. /api/health reports what is missing.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return response;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(list) {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // Must run: this refreshes an expiring token and rewrites the cookies.
  const { data: { user } } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
