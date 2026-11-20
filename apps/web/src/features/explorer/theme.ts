export const themeCookie = "archmind-theme";

export type ThemePreference = "system" | "light" | "dark";

export function parseThemePreference(value: string | undefined): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}
