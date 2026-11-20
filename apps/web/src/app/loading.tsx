import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <main aria-busy="true" className="mx-auto max-w-[1740px] space-y-5 px-4 py-6 sm:px-8">
      <h1 className="text-2xl font-semibold">Architecture explorer</h1>
      <p role="status">Loading snapshots…</p>
      <Skeleton className="h-[70dvh]" />
    </main>
  );
}
