import { redirect } from "next/navigation";
import { getMyProfile } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { localDate } from "@/lib/calc";
import LogComposer from "@/components/LogComposer";
import { geminiConfigured } from "@/lib/gemini";

export const dynamic = "force-dynamic";
export const metadata = { title: "Log · FitClash" };

export default async function LogPage() {
  const profile = await getMyProfile();
  if (!profile) redirect("/login");

  const today = localDate(profile.timezone);
  const supabase = await createClient();
  const { data: rest } = await supabase
    .from("rest_days").select("local_date")
    .eq("user_id", profile.id).eq("local_date", today).maybeSingle();

  return (
    <LogComposer
      profile={profile}
      today={today}
      isRestDay={Boolean(rest)}
      aiReady={geminiConfigured()}
    />
  );
}
