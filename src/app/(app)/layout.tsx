import { redirect } from "next/navigation";
import BottomNav from "@/components/BottomNav";
import { getMyProfile } from "@/lib/data";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getMyProfile();

  // proxy.ts already bounced anonymous visitors; this covers the gap where a
  // session exists but the profile row hasn't been filled in yet.
  if (!profile) redirect("/login");
  if (!profile.onboarded) redirect("/onboarding");

  return (
    <>
      <main className="safe-top mx-auto w-full max-w-md px-4">{children}</main>
      <BottomNav />
    </>
  );
}
