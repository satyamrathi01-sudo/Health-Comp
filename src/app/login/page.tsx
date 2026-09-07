import { Suspense } from "react";
import LoginForm from "./LoginForm";
import { redirect } from "next/navigation";
import { isHosted, missingSupabaseEnv, supabaseConfigured } from "@/lib/supabase/server";
import { getMyProfile } from "@/lib/data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in · FitClash" };

export default async function LoginPage() {
  const profile = await getMyProfile();
  if (profile) redirect(profile.onboarded ? "/" : "/onboarding");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-ink-900 text-2xl">
          ⚡
        </div>
        <h1 className="hero-num text-3xl">FitClash</h1>
        <p className="mt-3 text-sm leading-relaxed text-mist-600">
          Log what you eat and how you train. Gemini does the maths.
          <br />
          One of you wins the day.
        </p>
      </div>
      {supabaseConfigured() ? (
        <Suspense fallback={<div className="surface h-72 thinking" />}>
          <LoginForm />
        </Suspense>
      ) : (
        <div className="surface space-y-3 p-5 text-sm leading-relaxed">
          <p className="font-semibold text-gold">Not configured yet</p>

          <div>
            <p className="mb-2 text-mist-600">Missing:</p>
            <ul className="space-y-1">
              {missingSupabaseEnv().map((name) => (
                <li key={name} className="tnum text-xs text-danger">
                  <code>{name}</code>
                </li>
              ))}
            </ul>
          </div>

          {isHosted() ? (
            <p className="text-mist-600">
              Add these in your host&apos;s environment variables, then{" "}
              <strong className="text-mist-400">redeploy</strong>.{" "}
              <code className="text-mist-400">NEXT_PUBLIC_</code> values are compiled into
              the build, so saving them without a fresh build changes nothing.
            </p>
          ) : (
            <p className="text-mist-600">
              Copy <code className="text-mist-400">.env.local.example</code> to{" "}
              <code className="text-mist-400">.env.local</code>, fill it in, then restart
              the dev server. See the README for the 10-minute setup.
            </p>
          )}
        </div>
      )}
    </main>
  );
}
