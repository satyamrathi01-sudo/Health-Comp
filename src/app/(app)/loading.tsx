/**
 * Shown the instant a tab is tapped, while the server renders.
 *
 * Next also prefetches this shell for linked routes, so navigation paints
 * immediately instead of appearing frozen until the data arrives. That is a
 * perceived-speed fix; the actual latency work is the single-round-trip
 * get_arena() call and pinning the function region next to the database.
 */
export default function Loading() {
  return (
    <div className="safe-top">
      <div className="mb-7">
        <div className="h-7 w-32 rounded bg-ink-850 thinking" />
        <div className="mt-2 h-3.5 w-40 rounded bg-ink-900 thinking" />
      </div>

      <div className="flex justify-center py-4">
        <div
          className="thinking rounded-full border-[10px] border-ink-850"
          style={{ width: 232, height: 232 }}
        />
      </div>

      <div className="mt-8 grid grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <div className="h-6 w-12 rounded bg-ink-850 thinking" />
            <div className="h-2.5 w-14 rounded bg-ink-900 thinking" />
          </div>
        ))}
      </div>

      <div className="mt-9 space-y-2.5">
        <div className="h-2.5 w-24 rounded bg-ink-900 thinking" />
        <div className="h-24 rounded-[1.25rem] bg-ink-900 thinking" />
        <div className="h-16 rounded-[1.25rem] bg-ink-900 thinking" />
      </div>
    </div>
  );
}
