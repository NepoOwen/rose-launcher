import { invoke } from "@tauri-apps/api/core";
import { runtimeCache } from "@/lib/runtimeCache";

const OBFUS_KEY = "rose_pd_k3y_x!9#rose";
const NOISE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789;:!=_-,./\\%<>&";
const NOISE_LEN = 3;
const NOISE_LEN_LEGACY = 79;

function _rndStr(len: number): string {
  let r = "";
  for (let i = 0; i < len; i++)
    r += NOISE_CHARS[Math.floor(Math.random() * NOISE_CHARS.length)];
  return r;
}

function encodeFile(plain: string): string {
  let enc = "";
  for (let i = 0; i < plain.length; i++) {
    const kc = OBFUS_KEY[i % OBFUS_KEY.length];
    enc += _rndStr(NOISE_LEN) + String.fromCharCode(plain.charCodeAt(i) + (kc.charCodeAt(0) % 26));
  }
  const b64 = btoa(enc);
  const rand = Math.floor(Math.random() * 240) + 16;
  const nonce = (Math.floor(Math.random() * 9e15) + 1e15).toFixed(0);
  const hexRand = rand.toString(16).toUpperCase().padStart(2, "0");
  const hexNoise = NOISE_LEN.toString(16).toUpperCase().padStart(2, "0");
  return `PD!1234567890ABCDEF(${nonce}${_rndStr(rand)}${hexRand}${hexNoise})(${b64})`;
}

function decodeFile(str: string): string {
  if (!str.startsWith("PD")) return "";

  const firstMatch = str.match(/^PD\d?!1234567890ABCDEF\(([^()]+)\)/);
  if (!firstMatch) return "";
  const check = firstMatch[1];

  const lastMatch = str.match(/\(([^()]*)\)$/);
  if (!lastMatch) return "";

  let enc: string;
  try { enc = atob(lastMatch[1]); } catch { return ""; }

  const decodeWithStride = (stride: number): string => {
    let out = "";
    let j = 0;
    while (j + stride < enc.length) {
      j += stride;
      const kc = OBFUS_KEY[out.length % OBFUS_KEY.length];
      out += String.fromCharCode(enc.charCodeAt(j) - (kc.charCodeAt(0) % 26));
      j++;
    }
    return out;
  };

  const randWithStride = parseInt(check.slice(-4, -2), 16);
  const stride = parseInt(check.slice(-2), 16);
  if (!isNaN(randWithStride) && !isNaN(stride) && stride > 0 && randWithStride + 16 === check.length - 4) {
    return decodeWithStride(stride);
  }

  const randLegacy = parseInt(check.slice(-2), 16);
  if (!isNaN(randLegacy) && randLegacy + 16 === check.length - 2) {
    for (const legacyStride of [NOISE_LEN, NOISE_LEN_LEGACY]) {
      const out = decodeWithStride(legacyStride);
      try { JSON.parse(out); return out; } catch { }
    }
  }

  return "";
}

function _decodeLegacyXor(encoded: string): string {
  const KEY = "pd9x!@#$%^&*()_+rose";
  const raw = atob(encoded);
  let out = "";
  for (let i = 0; i < raw.length; i++)
    out += String.fromCharCode(raw.charCodeAt(i) ^ KEY.charCodeAt(i % KEY.length));
  return out;
}

interface PdStore {
  a?: { rm: boolean; cl: boolean; zm: number };
  tos?: boolean;
  m?: PdAccount[];
  grp?: PdAccountGroup[];
  gp?: { trovePath?: string; trovePathPts?: string; injectorPath?: string; region?: string; autoRelog?: boolean; singleAccountInstance?: boolean; autoUpdate?: boolean };
}

interface PdAccountGroup {
  id: string;
  name: string;
  ord: number;
  col: boolean;
}

interface PdAccount {
  email: string;
  password: string;
  username?: string;
  userId?: number;
  gid?: string;
  ord?: number;
  g?: GlyphSession;
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const toRuntimeAccounts = (accounts: PdAccount[]): Array<{ email: string; password: string; username?: string; userId?: number; groupId?: string; order?: number }> =>
  accounts.map(a => ({
    email: a.email,
    password: a.password,
    ...(a.username ? { username: a.username } : {}),
    ...(a.userId && a.userId > 0 ? { userId: a.userId } : {}),
    ...(a.gid ? { groupId: a.gid } : {}),
    ...(typeof a.ord === "number" ? { order: a.ord } : {}),
  }));

export const accountKey = (a: { email: string; userId?: number }): string => {
  if (a.userId && a.userId > 0) return String(a.userId);
  return normalizeEmail(a.email);
};

function normalizeStore(input: PdStore): PdStore {
  const accountsByEmail = new Map<string, PdAccount>();

  const upsertAccount = (raw: any): PdAccount | null => {
    if (!raw || typeof raw !== "object") return null;
    const emailRaw = typeof raw.email === "string" ? raw.email.trim() : "";
    if (!emailRaw) return null;
    const emailKey = normalizeEmail(emailRaw);

    const current: PdAccount = accountsByEmail.get(emailKey) ?? {
      email: emailRaw,
      password: "",
    };

    if (!current.email) current.email = emailRaw;
    if (typeof raw.password === "string") current.password = raw.password;
    if (typeof raw.username === "string" && raw.username.trim()) current.username = raw.username;
    if (Number.isFinite(raw.userId) && Number(raw.userId) > 0) current.userId = Number(raw.userId);
    if (typeof raw.gid === "string" && raw.gid.trim()) current.gid = raw.gid;
    if (typeof raw.ord === "number" && Number.isFinite(raw.ord)) current.ord = raw.ord;

    if (raw.g && typeof raw.g === "object" && typeof raw.g.details_b64 === "string") {
      current.g = {
        details_b64: raw.g.details_b64,
        saved_at_unix: Number.isFinite(raw.g.saved_at_unix) ? Number(raw.g.saved_at_unix) : 0,
        ...(typeof raw.g.refresh_error === "string" ? { refresh_error: raw.g.refresh_error } : {}),
      };
    }

    accountsByEmail.set(emailKey, current);
    return current;
  };

  for (const account of Array.isArray(input.m) ? input.m : []) upsertAccount(account);

  return {
    ...input,
    m: Array.from(accountsByEmail.values()),
  };
}

async function loadRaw(): Promise<PdStore> {
  try {
    const raw = await invoke<string>("read_pd_file");
    if (!raw) return {};
    if (raw.startsWith("PD")) {
      const decoded = decodeFile(raw);
      if (decoded) {
        return normalizeStore(JSON.parse(decoded) as PdStore);
      }
    }
    try {
      const decoded = _decodeLegacyXor(raw);
      return normalizeStore(JSON.parse(decoded) as PdStore);
    } catch { }
    return normalizeStore(JSON.parse(raw) as PdStore);
  } catch {
    return {};
  }
}

async function saveRaw(data: PdStore): Promise<void> {
  const encoded = encodeFile(JSON.stringify(normalizeStore(data)));
  await invoke<void>("write_pd_file", { content: encoded });
}

async function patch(delta: Partial<PdStore>): Promise<void> {
  const current = await loadRaw();
  await saveRaw({ ...current, ...delta });
}

export async function hydratePd(): Promise<void> {
  const data = await loadRaw();
  if (Object.keys(data).length === 0) return;

  let dirty = false;
  if (data.a && (data.a as any).fontSize !== undefined) {
    const { fontSize: _removed, ...clean } = data.a as any;
    data.a = clean;
    dirty = true;
  }
  if (data.a && (data.a as any).reduceMotion !== undefined) {
    const old = data.a as any;
    data.a = { rm: old.reduceMotion ?? false, cl: old.compactLayout ?? false, zm: old.zoom ?? 1 };
    dirty = true;
  }
  if (dirty) await saveRaw(data);

  if (data.a && !runtimeCache.hasItem("accessibility")) {
    try { runtimeCache.setItem("accessibility", JSON.stringify(data.a)); } catch { }
  }
  const accounts = data.m ?? [];
  if (accounts.length > 0 && !runtimeCache.hasItem("glyph_manual_accounts")) {
    try { runtimeCache.setItem("glyph_manual_accounts", JSON.stringify(toRuntimeAccounts(accounts))); } catch { }
  }

  if (data.tos && !runtimeCache.hasItem("tos_accepted")) {
    try { runtimeCache.setItem("tos_accepted", "1"); } catch { }
  }
}

export const persistAccessibility = (a: { rm: boolean; cl: boolean; zm: number }) => patch({ a });

export const persistManualAccounts = (m: Array<{ email: string; password: string; username?: string; userId?: number; groupId?: string; order?: number }>) =>
  saveManualAccountsPd(m);

export const loadManualAccountsPd = async (): Promise<Array<{ email: string; password: string; username?: string; userId?: number; groupId?: string; order?: number }>> => {
  const current = await loadRaw();
  return toRuntimeAccounts(current.m ?? []);
};

export const saveManualAccountsPd = async (m: Array<{ email: string; password: string; username?: string; userId?: number; groupId?: string; order?: number }>) => {
  const current = await loadRaw();
  const existingByEmail = new Map((current.m ?? []).map(a => [normalizeEmail(a.email), a]));
  const nextAccounts = m
    .map(a => {
      const key = normalizeEmail(a.email);
      const existing = existingByEmail.get(key);
      return {
        email: a.email,
        password: a.password,
        ...(a.username ? { username: a.username } : {}),
        ...(a.userId && a.userId > 0 ? { userId: a.userId } : {}),
        ...(a.groupId ? { gid: a.groupId } : {}),
        ...(typeof a.order === "number" ? { ord: a.order } : {}),
        ...(existing?.g ? { g: existing.g } : {}),
      } as PdAccount;
    })
    .filter(a => !!a.email.trim());
  await saveRaw({ ...current, m: nextAccounts });
};

export interface GlyphSession {
  details_b64: string;
  saved_at_unix: number;
  refresh_error?: string;
}

export const getGlyphSessionPd = async (email: string): Promise<GlyphSession | null> => {
  const current = await loadRaw();
  const key = normalizeEmail(email);
  const account = (current.m ?? []).find(a => normalizeEmail(a.email) === key);
  return account?.g ?? null;
};

export const saveGlyphSessionPd = async (email: string, session: GlyphSession) => {
  const current = await loadRaw();
  const key = normalizeEmail(email);
  const accounts = [...(current.m ?? [])];
  const idx = accounts.findIndex(a => normalizeEmail(a.email) === key);
  if (idx >= 0) {
    accounts[idx] = { ...accounts[idx], g: session };
  } else {
    accounts.push({ email: email.trim(), password: "", g: session });
  }
  await saveRaw({ ...current, m: accounts });
};

export const setGlyphSessionErrorPd = async (email: string, error: string) => {
  const current = await loadRaw();
  const key = normalizeEmail(email);
  const accounts = [...(current.m ?? [])];
  const idx = accounts.findIndex(a => normalizeEmail(a.email) === key);
  if (idx < 0 || !accounts[idx].g) return;
  accounts[idx] = { ...accounts[idx], g: { ...accounts[idx].g!, refresh_error: error } };
  await saveRaw({ ...current, m: accounts });
};

export const clearGlyphSessionErrorPd = async (email: string) => {
  const current = await loadRaw();
  const key = normalizeEmail(email);
  const accounts = [...(current.m ?? [])];
  const idx = accounts.findIndex(a => normalizeEmail(a.email) === key);
  if (idx < 0 || !accounts[idx].g) return;
  const { refresh_error: _, ...rest } = accounts[idx].g!;
  accounts[idx] = { ...accounts[idx], g: rest };
  await saveRaw({ ...current, m: accounts });
};

export const getAllGlyphSessionsPd = async (): Promise<Record<string, GlyphSession>> => {
  const current = await loadRaw();
  const out: Record<string, GlyphSession> = {};
  for (const account of current.m ?? []) {
    if (!account.g) continue;
    out[normalizeEmail(account.email)] = account.g;
  }
  return out;
};

export const removeGlyphSessionPd = async (email: string) => {
  const current = await loadRaw();
  const key = normalizeEmail(email);
  const accounts = [...(current.m ?? [])];
  const idx = accounts.findIndex(a => normalizeEmail(a.email) === key);
  if (idx < 0) return;
  const { g: _removed, ...rest } = accounts[idx];
  accounts[idx] = rest;
  await saveRaw({ ...current, m: accounts });
};

export const loadGlyphPrefsPd = async (): Promise<{ trovePath?: string; trovePathPts?: string; injectorPath?: string; region?: string; autoRelog?: boolean; singleAccountInstance?: boolean; autoUpdate?: boolean }> => {
  const current = await loadRaw();
  return current.gp ?? {};
};

export const saveGlyphPrefsPd = async (prefs: { trovePath?: string; trovePathPts?: string; injectorPath?: string; region?: string; autoRelog?: boolean; singleAccountInstance?: boolean; autoUpdate?: boolean }) => {
  const current = await loadRaw();
  const merged = { ...(current.gp ?? {}), ...prefs };
  await saveRaw({ ...current, gp: merged });
};

export const persistTos = () => patch({ tos: true });

export interface AccountGroup {
  id: string;
  name: string;
  order: number;
  collapsed: boolean;
}

export const DEFAULT_GROUP_ID = "default";
export const DEFAULT_GROUP_NAME = "Uncategorized";

export async function loadAccountGroups(): Promise<AccountGroup[]> {
  const data = await loadRaw();
  const groups = (data.grp ?? []).map(g => ({
    id: g.id,
    name: g.name,
    order: g.ord,
    collapsed: g.col ?? false,
  })).sort((a, b) => a.order - b.order);

  if (!groups.some(g => g.id === DEFAULT_GROUP_ID)) {
    groups.unshift({ id: DEFAULT_GROUP_ID, name: DEFAULT_GROUP_NAME, order: -1, collapsed: false });
  }
  return groups;
}

export async function saveAccountGroups(groups: AccountGroup[]): Promise<void> {
  const current = await loadRaw();
  const grp: PdAccountGroup[] = groups.map(g => ({
    id: g.id,
    name: g.name,
    ord: g.order,
    col: g.collapsed,
  }));
  await saveRaw({ ...current, grp });
}
