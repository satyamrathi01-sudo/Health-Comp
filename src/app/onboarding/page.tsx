import { redirect } from "next/navigation";
import { getMyProfile } from "@/lib/data";
import OnboardingFlow from "./OnboardingFlow";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set up · FitClash" };

export default async function OnboardingPage() {
  const profile = await getMyProfile();
  if (!profile) redirect("/login");
  if (profile.onboarded) redirect("/");

  return (
    <main className="safe-top mx-auto w-full max-w-md px-5 pb-8">
      <OnboardingFlow profile={profile} />
    </main>
  );
}
