import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { parseThemePreference, themeCookie } from "@/features/explorer/theme";

import "@xyflow/react/dist/style.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Architecture Explorer | ArchMind",
  description: "Explore components and dependencies in local architecture snapshots."
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = parseThemePreference((await cookies()).get(themeCookie)?.value);
  return (
    <html lang="en" data-theme={theme}>
      <body>{children}</body>
    </html>
  );
}
