import { fetchSnapshots } from "@/features/explorer/api";
import { apiOrigin } from "@/features/explorer/api-origin";
import { Explorer } from "@/features/explorer/explorer";

export const dynamic = "force-dynamic";

export default async function Home() {
  try {
    const initial = await fetchSnapshots(apiOrigin());
    return <Explorer initial={initial} />;
  } catch {
    return (
      <Explorer
        initial={{
          error: "Could not load snapshots. Check that the local API is running, then refresh."
        }}
      />
    );
  }
}
