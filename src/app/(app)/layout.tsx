import BottomNav from "@/components/BottomNav";
import InstallPrompt from "@/components/InstallPrompt";

/**
 * Deliberately does no data fetching.
 *
 * It used to load the profile just to check `onboarded`, which added a full
 * database round trip in front of every page's own query — and layouts render
 * before pages, so it was pure added latency on every navigation. Each page
 * calls requireArena(), which gets the same flag out of the query it was
 * making anyway. Anonymous requests are still turned away by proxy.ts.
 *
 * The home-screen offer lives here rather than on one page so it appears
 * wherever someone lands after signing in. It fetches nothing.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <main className="safe-top mx-auto w-full max-w-md px-4">{children}</main>
      <BottomNav />
      <InstallPrompt />
    </>
  );
}
