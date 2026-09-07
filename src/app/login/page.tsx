import { Suspense } from "react";
import LoginForm from "./LoginForm";
import { supabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in · FitClash" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-ink-850 text-3xl">
          ⚡
        </div>
        <h1 className="text-3xl font-bold tracking-tight">FitClash</h1>
        <p className="mt-2 text-sm leading-relaxed text-mist-500">
          Log what you eat and how you train. Gemini does the maths.
          <br />
          One of you wins the day.
        </p>
      </div>
      {supabaseConfigured() ? (
        <Suspense fallback={<div className="card h-72 thinking" />}>
          <LoginForm />
        </Suspense>
      ) : (
        <div className="card space-y-2 p-5 text-sm leading-relaxed">
          <p className="font-semibold text-gold">Not configured yet</p>
          <p className="text-mist-500">
            Copy <code className="text-mist-300">.env.local.example</code> to{" "}
            <code className="text-mist-300">.env.local</code>, add your Supabase URL and
            anon key, then restart the dev server. See the README for the 10-minute setup.
          </p>
        </div>
      )}
    </main>
  );
}
