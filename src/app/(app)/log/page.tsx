import { mine, requireArena } from "@/lib/data";
import LogComposer from "@/components/LogComposer";
import { geminiConfigured } from "@/lib/gemini";

export const dynamic = "force-dynamic";
export const metadata = { title: "Log · FitClash" };

/**
 * One day of history is all this screen needs, and one round trip is all it
 * takes: the profile, today's date in the user's own timezone and whether
 * today is already marked as a rest day all come back together. It used to
 * fetch the profile, then ask separately about the rest day.
 */
export default async function LogPage() {
  const arena = await requireArena({ days: 1 });
  const today = arena.today;
  const isRestDay = mine(arena).totals.get(today)?.is_rest_day ?? false;

  return (
    <LogComposer
      profile={arena.me}
      today={today}
      isRestDay={isRestDay}
      aiReady={geminiConfigured()}
    />
  );
}
