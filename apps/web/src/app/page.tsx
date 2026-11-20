import { fetchSnapshots } from "@/features/explorer/api";
import { apiOrigin } from "@/features/explorer/api-origin";
import { Explorer } from "@/features/explorer/explorer";
import { parseThemePreference, themeCookie } from "@/features/explorer/theme";

export const dynamic = "force-dynamic";

export default async function Home() {
  const theme = parseThemePreference((await cookies()).get(themeCookie)?.value);
  try {
    const initial = await fetchSnapshots(apiOrigin());
    return <Explorer initial={initial} initialTheme={theme} />;
  } catch {
    return (
      <Explorer
        initialTheme={theme}
        initial={{
          error: "Could not load snapshots. Check that the local API is running, then refresh."
        }}
      />
    );
  }
}
import { cookies } from "next/headers";
