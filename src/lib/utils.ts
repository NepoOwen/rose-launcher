import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { DEFAULT_CUSTOM_THEME, type AccessibilitySettings, type ThemePreset } from "@/lib/api";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const getRoleColor = (role: string | undefined): string => {
  if (!role) return "hsl(var(--foreground))";

  const roleMap: Record<string, string> = {
    admin: "hsl(0 84% 60%)",
    mod: "hsl(150 60% 35%)",
    beta: "hsl(190 80% 40%)",
    chief: "hsl(45 90% 50%)",
    premium: "hsl(var(--primary))",
    banned: "hsl(0 0% 50%)",
  };

  return roleMap[role.toLowerCase()] || "hsl(var(--foreground))";
};

export const ZOOM_STEPS = [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
export const ZOOM_DEFAULT = 1;
export const ZOOM_MIN = ZOOM_STEPS[0];
export const ZOOM_MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1];

export const applyAccessibility = (s: AccessibilitySettings) => {
  const html = document.documentElement;
  html.classList.toggle("reduce-motion", s.rm);
  html.classList.toggle("compact", s.cl);
  html.style.fontSize = `${(s.zm ?? 1) * 100}%`;
  (document.body.style as any).zoom = "";
};

const hslStr = (h: number, s: number, l: number) =>
  `${Math.round(h)} ${Math.round(Math.max(0, Math.min(100, s)))}% ${Math.round(Math.max(0, Math.min(100, l)))}%`;

const parseHsl = (str: string): [number, number, number] => {
  const parts = str.trim().split(/\s+/);
  return [parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2])];
};

export const themePresets: Record<ThemePreset, { primary: string; primaryGlow: string; background: string; foreground: string }> = {
  default:  { primary: "240 100% 78%", primaryGlow: "240 100% 88%", background: "240 10% 8%",  foreground: "0 0% 98%" },
  ocean:    { primary: "200 100% 50%", primaryGlow: "200 100% 70%", background: "210 50% 8%",  foreground: "210 40% 98%" },
  sunset:   { primary: "25 95% 53%",  primaryGlow: "35 100% 70%",  background: "25 40% 8%",   foreground: "35 50% 98%" },
  forest:   { primary: "142 76% 36%", primaryGlow: "142 76% 56%", background: "140 30% 8%",  foreground: "140 40% 98%" },
  midnight: { primary: "263 70% 50%", primaryGlow: "263 70% 70%", background: "260 40% 5%",  foreground: "260 20% 98%" },
  crimson:  { primary: "0 84% 60%",   primaryGlow: "0 84% 75%",   background: "0 40% 8%",    foreground: "0 20% 98%" },
  amber:    { primary: "45 100% 51%", primaryGlow: "45 100% 70%", background: "45 35% 8%",   foreground: "45 40% 98%" },
  emerald:  { primary: "160 84% 39%", primaryGlow: "160 84% 60%", background: "160 30% 8%",  foreground: "160 25% 98%" },
  sapphire: { primary: "217 91% 60%", primaryGlow: "217 91% 75%", background: "220 45% 8%",  foreground: "220 30% 98%" },
  rose:     { primary: "330 81% 60%", primaryGlow: "330 81% 75%", background: "330 35% 8%",  foreground: "330 25% 98%" },
  violet:   { primary: "270 91% 65%", primaryGlow: "270 91% 80%", background: "270 40% 7%",  foreground: "270 25% 98%" },
  lime:     { primary: "85 85% 55%",  primaryGlow: "85 85% 70%",  background: "85 30% 8%",   foreground: "85 30% 98%" },
  cyan:     { primary: "189 94% 43%", primaryGlow: "189 94% 65%", background: "190 45% 8%",  foreground: "190 35% 98%" },
  magenta:  { primary: "300 76% 58%", primaryGlow: "300 76% 75%", background: "300 38% 7%",  foreground: "300 25% 98%" },
  gold:     { primary: "48 96% 53%",  primaryGlow: "48 96% 70%",  background: "48 40% 8%",   foreground: "48 35% 98%" },
  dark:     { primary: "0 0% 70%",    primaryGlow: "0 0% 85%",    background: "0 0% 5%",     foreground: "0 0% 98%" },
  teal:     { primary: "173 80% 40%", primaryGlow: "173 80% 58%", background: "173 35% 8%",  foreground: "173 30% 98%" },
  custom:   { primary: "240 100% 78%", primaryGlow: "240 100% 88%", background: "240 10% 8%", foreground: "0 0% 98%" },
};

export function parseCustomTheme(ct: string): { primary: string; glow: string; background: string; foreground: string } {
  const [primary = "240 100% 78%", glow = "240 100% 88%", background = "240 10% 8%", foreground = "0 0% 98%"] = ct.split("|");
  return { primary, glow, background, foreground };
}

export function serializeCustomTheme(p: { primary: string; glow: string; background: string; foreground: string }): string {
  return `${p.primary}|${p.glow}|${p.background}|${p.foreground}`;
}

export const applyTheme = (preset: ThemePreset, darkMode: boolean, coloredBg: boolean, customTheme?: string) => {
  const root = document.documentElement;

  if (preset === "custom") {
    const ct = parseCustomTheme(customTheme ?? DEFAULT_CUSTOM_THEME);
    const [bh, bs, bl] = parseHsl(ct.background);
    const isLight = bl > 50;
    const step = isLight ? -2 : 2;
    root.classList.toggle("light-mode", isLight);
    const [ph, , pl] = parseHsl(ct.primary);
    const pfg = pl > 50 ? hslStr(ph, 30, 10) : "0 0% 98%";
    root.style.setProperty("--primary",                    ct.primary);
    root.style.setProperty("--primary-glow",               ct.glow);
    root.style.setProperty("--ring",                       ct.primary);
    root.style.setProperty("--accent",                     ct.primary);
    root.style.setProperty("--sidebar-primary",            ct.primary);
    root.style.setProperty("--sidebar-accent",             ct.glow);
    root.style.setProperty("--chart-1",                    ct.primary);
    root.style.setProperty("--primary-foreground",         pfg);
    root.style.setProperty("--accent-foreground",          pfg);
    root.style.setProperty("--sidebar-primary-foreground", pfg);
    root.style.setProperty("--background",          ct.background);
    root.style.setProperty("--foreground",          ct.foreground);
    root.style.setProperty("--card",                hslStr(bh, bs, bl + step));
    root.style.setProperty("--card-foreground",     ct.foreground);
    root.style.setProperty("--popover",             hslStr(bh, bs, bl + step * 2));
    root.style.setProperty("--popover-foreground",  ct.foreground);
    root.style.setProperty("--secondary",           hslStr(bh, bs, bl + step * 3));
    root.style.setProperty("--secondary-foreground", ct.foreground);
    root.style.setProperty("--muted",               hslStr(bh, bs * 0.8, bl + step * 5));
    root.style.setProperty("--muted-foreground",    isLight ? hslStr(bh, 10, 45) : hslStr(bh, 10, bl + 42));
    root.style.setProperty("--border",              hslStr(bh, bs, bl + step * 4));
    root.style.setProperty("--input",               hslStr(bh, bs, bl + step * 3));
    root.style.setProperty("--sidebar-background",  hslStr(bh, bs, bl + step));
    root.style.setProperty("--sidebar-foreground",  ct.foreground);
    root.style.setProperty("--sidebar-border",      hslStr(bh, bs, bl + step * 3));
    root.style.setProperty("--sidebar-ring",        ct.primary);
    return;
  }

  root.classList.remove("light-mode");

  const t = themePresets[preset] ?? themePresets.default;
  const [ph, , pl] = parseHsl(t.primary);
  const pfg = pl > 50 ? hslStr(ph, 30, 10) : "0 0% 98%";

  root.style.setProperty("--primary",                    t.primary);
  root.style.setProperty("--primary-glow",               t.primaryGlow);
  root.style.setProperty("--ring",                       t.primary);
  root.style.setProperty("--accent",                     t.primary);
  root.style.setProperty("--sidebar-primary",            t.primary);
  root.style.setProperty("--sidebar-accent",             t.primaryGlow);
  root.style.setProperty("--chart-1",                    t.primary);
  root.style.setProperty("--primary-foreground",         pfg);
  root.style.setProperty("--accent-foreground",          pfg);
  root.style.setProperty("--sidebar-primary-foreground", pfg);

  if (darkMode) {
    const [bh, bs] = coloredBg ? parseHsl(t.background) : [220, 15];
    const bl = 8;
    const fg = coloredBg ? t.foreground : "0 0% 90%";
    root.style.setProperty("--background",          hslStr(bh, bs, bl));
    root.style.setProperty("--foreground",           fg);
    root.style.setProperty("--card",                 hslStr(bh, bs, bl + 2));
    root.style.setProperty("--card-foreground",      fg);
    root.style.setProperty("--popover",              hslStr(bh, bs, bl + 4));
    root.style.setProperty("--popover-foreground",   fg);
    root.style.setProperty("--secondary",            hslStr(bh, bs, bl + 6));
    root.style.setProperty("--secondary-foreground", coloredBg ? t.foreground : "0 0% 85%");
    root.style.setProperty("--muted",                hslStr(bh, bs * 0.8, bl + 10));
    root.style.setProperty("--muted-foreground",     hslStr(bh, 10, bl + 42));
    root.style.setProperty("--border",               hslStr(bh, bs, bl + 8));
    root.style.setProperty("--input",                hslStr(bh, bs, bl + 6));
    root.style.setProperty("--sidebar-background",   hslStr(bh, bs, bl + 1));
    root.style.setProperty("--sidebar-foreground",   fg);
    root.style.setProperty("--sidebar-border",       hslStr(bh, bs, bl + 6));
    root.style.setProperty("--sidebar-ring",         t.primary);
  } else {
    const bh = coloredBg ? parseHsl(t.background)[0] : 0;
    const bs = coloredBg ? 20 : 0;
    const bl = 96;
    const fg = hslStr(bh, 10, 10);
    root.style.setProperty("--background",          hslStr(bh, bs, bl));
    root.style.setProperty("--foreground",           fg);
    root.style.setProperty("--card",                 hslStr(bh, bs, bl - 2));
    root.style.setProperty("--card-foreground",      fg);
    root.style.setProperty("--popover",              hslStr(bh, bs, bl - 1));
    root.style.setProperty("--popover-foreground",   fg);
    root.style.setProperty("--secondary",            hslStr(bh, bs, bl - 5));
    root.style.setProperty("--secondary-foreground", fg);
    root.style.setProperty("--muted",                hslStr(bh, bs * 0.5, bl - 8));
    root.style.setProperty("--muted-foreground",     hslStr(bh, 10, 50));
    root.style.setProperty("--border",               hslStr(bh, bs, bl - 12));
    root.style.setProperty("--input",                hslStr(bh, bs, bl - 5));
    root.style.setProperty("--sidebar-background",   hslStr(bh, bs, bl - 2));
    root.style.setProperty("--sidebar-foreground",   fg);
    root.style.setProperty("--sidebar-border",       hslStr(bh, bs, bl - 10));
    root.style.setProperty("--sidebar-ring",         t.primary);
    root.style.setProperty("--primary-foreground",   "0 0% 98%");
    root.style.setProperty("--accent-foreground",    fg);
  }
};
