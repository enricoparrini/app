import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  surface: "#FDFBF7",
  onSurface: "#1A1C1A",
  surfaceSecondary: "#FFFFFF",
  onSurfaceSecondary: "#1A1C1A",
  surfaceTertiary: "#F4EFE6",
  onSurfaceTertiary: "#2B2D2C",
  surfaceInverse: "#2B2D2C",
  onSurfaceInverse: "#FDFBF7",
  muted: "#737A74",

  brand: "#7CA982",
  onBrand: "#FFFFFF",
  brandPrimary: "#5B8266",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#C2D5C4",
  onBrandSecondary: "#1A1C1A",
  brandTertiary: "#E4EDE5",
  onBrandTertiary: "#1A1C1A",

  success: "#5B8266",
  onSuccess: "#FFFFFF",
  warning: "#D49A44",
  onWarning: "#FFFFFF",
  error: "#B85C50",
  onError: "#FFFFFF",
  info: "#6B8E9B",
  onInfo: "#FFFFFF",

  border: "#E8E2D9",
  borderStrong: "#D1C9BC",
  divider: "#E8E2D9",
};

export type ThemeColors = typeof light;
export const defaultScheme = "light" satisfies ColorScheme;
export const themes: { light: ThemeColors; dark?: ThemeColors } = { light };

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}
setColorScheme?.(themes.dark ? null : defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = system && themes[system] ? system : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.light };
}

export const colors = light;

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}
