import { invoke } from "@tauri-apps/api/core";
import { persistAccessibility, persistManualAccounts, persistTos } from "@/lib/pdStorage";
import { runtimeCache } from "@/lib/runtimeCache";

export const APP_VERSION = "0.1.0";

export interface GlyphLoginRequest {
  email: string;
  password: string;
  authCode?: string;
}

export interface SavedGlyphLogin {
  email: string;
  details_b64: string;
  saved_at_unix: number;
}

export interface GlyphLoginResult {
  status_code: number;
  details_b64: string;
  saved_at_unix: number;
  account_id?: string | null;
  trion_error?: string | null;
  trion_error_message?: string | null;
  trion_error_url?: string | null;
  trion_token_required?: string | null;
}

export function parseGlyphError(result: GlyphLoginResult): string | null {
  const { status_code, trion_error, trion_token_required } = result;
  if (!status_code || status_code < 400) return null;
  switch (status_code) {
    case 500:
      return "Account does not exist";
    case 401:
      if (trion_error === "LOGIN_FAILED") {
        if (trion_token_required?.toLowerCase().includes("mobile")) return null;
        if (trion_token_required?.toLowerCase().includes("email")) return null;
        return "Incorrect password";
      }
      if (trion_error === "TICKET_CORRUPT") return "Session ticket is corrupted";
      if (trion_error === "TICKET_EXPIRED") return "Session ticket has expired";
      if (trion_error === "TICKET_MAX_LIFETIME_EXCEEDED") return "Session ticket exceeded maximum lifetime";
      if (trion_error === "PASSWORD_CHANGED") return "Password was changed - please log in again";
      return "Authentication error";
    case 403:
      if (trion_error === "ACCOUNT_BANNED") return "Account is banned";
      if (trion_error === "ACCESS_DENIED") return "Access denied";
      if (trion_error === "RATE_LIMITED") return "Rate limited - try again later";
      return "Access forbidden";
    case 400:
      if (trion_error === "CLIENT_ERROR") return "Client error";
      if (trion_error === "SERVER_ERROR") return "Server error";
      return "Bad request";
    default:
      return trion_error ? `Error: ${trion_error}` : `Unexpected error (${status_code})`;
  }
}

export function parseGlyphErrorString(raw: string): string {
  if (!raw) return "Unknown error";

  if (raw.toLowerCase().includes("invalid authentication code")) return "Invalid authentication code";

  if (raw.toLowerCase().includes("email and password are required")) return "Email and password are required";

  if (raw.toLowerCase().includes("stored session is empty")) return "No saved session - please log in first";
  if (raw.toLowerCase().includes("invalid details_b64")) return "Saved session is corrupted - please log in again";

  const trionMatch = raw.match(/(?:Glyph login failed|Touch failed):\s*([A-Z_]+)/);
  if (trionMatch) {
    switch (trionMatch[1]) {
      case "LOGIN_FAILED":               return "Incorrect password";
      case "ACCOUNT_BANNED":             return "Account is banned";
      case "ACCESS_DENIED":              return "Access denied";
      case "RATE_LIMITED":               return "Rate limited - try again later";
      case "TICKET_CORRUPT":             return "Session ticket is corrupted";
      case "TICKET_EXPIRED":             return "Session ticket has expired";
      case "TICKET_MAX_LIFETIME_EXCEEDED": return "Session ticket exceeded maximum lifetime";
      case "PASSWORD_CHANGED":           return "Password was changed - please log in again";
      case "CLIENT_ERROR":               return "Client error";
      case "SERVER_ERROR":               return "Server error";
      default:                           return `Error: ${trionMatch[1]}`;
    }
  }

  if (/(?:HTTP|http)\s*500/.test(raw) || raw.toLowerCase().includes("account does not exist")) {
    return "Account does not exist";
  }

  const httpMatch = raw.match(/HTTP\s*(\d+)/i);
  if (httpMatch) return `Server error (HTTP ${httpMatch[1]})`;

  return raw.length > 120 ? raw.slice(0, 120) + "…" : raw;
}

export const glyphAuth = {
  loginAccount: (request: GlyphLoginRequest) =>
    invoke<GlyphLoginResult>("glyph_login_account", { request }),

  launchGameWithSavedSession: (
    detailsB64: string,
    trovePath?: string,
    accountEmail?: string,
    enforceSingleInstance?: boolean,
    region?: string,
    injectorPath?: string,
  ) =>
    invoke<number>("launch_trove_and_inject_saved", {
      detailsB64,
      trovePath,
      accountEmail,
      enforceSingleInstance,
      region,
      injectorPath,
    }),

  launchTrove: (detailsB64: string, trovePath?: string, region?: string) =>
    invoke<number>("launch_trove_saved", { detailsB64, trovePath, region }),

  resendAuthCode: (email: string) =>
    invoke<number>("glyph_resend_auth_code", { email }),

  touchAccount: (detailsB64: string) =>
    invoke<GlyphLoginResult>("glyph_touch_account", { detailsB64 }),
};

export type TroveChannel = "live" | "pts";

export interface UpdateCheckResult {
  localVersion: string | null;
  remoteVersion: string;
  upToDate: boolean;
  hasLocalManifest: boolean;
}

export const checkTroveUpdate = (troveExePath: string, channel: TroveChannel) =>
  invoke<UpdateCheckResult>("check_trove_update", { troveExePath, channel });

export const hasLocalManifest = (troveExePath: string) =>
  invoke<boolean>("has_local_manifest", { troveExePath });

export interface UpdateProgress {
  channel: TroveChannel;
  phase: "checking" | "downloading" | "paused" | "finalizing" | "done" | "error" | "cancelled";
  currentIndex: number;
  totalFiles: number;
  currentPath: string;
  fileBytesDone: number;
  fileBytesTotal: number;
  overallBytesDone: number;
  overallBytesTotal: number;
  message: string | null;
}

export const applyTroveUpdate = (troveExePath: string, channel: TroveChannel) =>
  invoke<void>("apply_trove_update", { troveExePath, channel });

export const downloadTroveFresh = (folder: string, channel: TroveChannel) =>
  invoke<string>("download_trove_fresh", { folder, channel });

export const cancelTroveUpdate = (channel: TroveChannel) =>
  invoke<void>("cancel_trove_update", { channel });

export const pauseTroveUpdate = (channel: TroveChannel) =>
  invoke<void>("pause_trove_update", { channel });

export const resumeTroveUpdate = (channel: TroveChannel) =>
  invoke<void>("resume_trove_update", { channel });

export const onUpdateProgress = async (cb: (progress: UpdateProgress) => void) => {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<UpdateProgress>("update-progress", e => cb(e.payload));
};

export type ThemePreset =
  | "default" | "ocean" | "sunset" | "forest" | "midnight" | "crimson"
  | "amber" | "emerald" | "sapphire" | "rose" | "violet" | "lime"
  | "cyan" | "magenta" | "gold" | "dark" | "teal" | "custom";

export interface AccessibilitySettings {
  rm: boolean;
  cl: boolean;
  zm: number;
}

const DEFAULT_ACCESSIBILITY: AccessibilitySettings = {
  rm: false,
  cl: false,
  zm: 1,
};

export const DEFAULT_CUSTOM_THEME = "240 100% 78%|240 100% 88%|240 10% 8%|0 0% 98%";

export const sessionState = {
  getAccessibility(): AccessibilitySettings {
    const raw = runtimeCache.getItem("accessibility");
    if (!raw) return { ...DEFAULT_ACCESSIBILITY };
    const parsed = JSON.parse(raw);
    return {
      rm: parsed.rm ?? parsed.reduceMotion ?? DEFAULT_ACCESSIBILITY.rm,
      cl: parsed.cl ?? parsed.compactLayout ?? DEFAULT_ACCESSIBILITY.cl,
      zm: parsed.zm ?? parsed.zoom ?? DEFAULT_ACCESSIBILITY.zm,
    };
  },

  setAccessibility(settings: AccessibilitySettings) {
    runtimeCache.setItem("accessibility", JSON.stringify(settings));
    persistAccessibility(settings);
  },

  getManualAccounts(): Array<{ email: string; password: string; username?: string; userId?: number }> {
    try {
      const raw = runtimeCache.getItem("glyph_manual_accounts");
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  },

  setManualAccounts(accounts: Array<{ manualId: string; email: string; password: string; username?: string; userId?: number }>) {
    runtimeCache.setItem("glyph_manual_accounts", JSON.stringify(accounts));
    persistManualAccounts(accounts);
  },

  getTosAccepted(): boolean {
    return runtimeCache.getItem("tos_accepted") === "1";
  },

  setTosAccepted() {
    runtimeCache.setItem("tos_accepted", "1");
    persistTos();
  },

  getSiteTheme(): { preset: ThemePreset; darkMode: boolean; coloredBg: boolean; customTheme: string } | null {
    const raw = runtimeCache.getItem("site_theme");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      preset: parsed.preset ?? "default",
      darkMode: parsed.darkMode ?? true,
      coloredBg: parsed.coloredBg ?? false,
      customTheme: parsed.customTheme ?? DEFAULT_CUSTOM_THEME,
    };
  },

  setSiteTheme(theme: { preset: ThemePreset; darkMode: boolean; coloredBg: boolean; customTheme: string }) {
    runtimeCache.setItem("site_theme", JSON.stringify(theme));
  },
};
