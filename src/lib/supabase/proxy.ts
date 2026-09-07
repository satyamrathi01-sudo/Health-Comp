import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseAnonKey, supabaseUrl } from "@/lib/env";

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

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"));

  const url = supabaseUrl();
  const key = supabaseAnonKey();

  // Settle public routes BEFORE touching Supabase. The auth call used to run
  // first, so a malformed URL took down /api/health and /login — precisely the
  // pages you need when the config is wrong. It also spent a network
  // round-trip on every icon request.
  if (isPublic || !url || !key) return response;

  let user = null;

  try {
    // createServerClient validates the URL eagerly and throws before any
    // await, so it has to sit inside the try alongside the request itself.
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(list) {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });

    // Must run: this refreshes an expiring token and rewrites the cookies.
    ({ data: { user } } = await supabase.auth.getUser());
  } catch (err) {
    // Fail open rather than 500 the whole site. Every page under (app)
    // re-checks the profile server-side and bounces to /login, so an
    // unauthenticated request still gets nowhere.
    console.error("proxy: Supabase auth unavailable —", (err as Error).message);
    return response;
  }

  if (!user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", path);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}
