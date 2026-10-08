import { useState, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Zap, Rocket, Play, Plus, Trash2, CheckCircle2, AlertTriangle,
  Eye, EyeOff, HelpCircle, LogIn, Settings, FolderOpen,
  Search, X, RefreshCw, ChevronDown, ChevronRight, GripVertical, Download,
} from "lucide-react";

const SHOW_LAUNCH_AND_INJECT = false;
const SHOW_SELECT_BUTTON = false;
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ConfirmDialog from "@/components/ConfirmDialog";
import { toast } from "@/hooks/use-toast";
import {
  glyphAuth, checkTroveUpdate, downloadTroveFresh, hasLocalManifest,
  parseGlyphError, parseGlyphErrorString, type TroveChannel,
} from "@/lib/api";
import {
  loadManualAccountsPd,
  saveManualAccountsPd,
  getGlyphSessionPd,
  saveGlyphSessionPd,
  setGlyphSessionErrorPd,
  removeGlyphSessionPd,
  loadGlyphPrefsPd,
  saveGlyphPrefsPd,
  loadAccountGroups,
  saveAccountGroups,
  accountKey,
  DEFAULT_GROUP_ID,
  DEFAULT_GROUP_NAME,
  type AccountGroup,
} from "@/lib/pdStorage";


interface GlyphSettings {
  autoRelog: boolean;
  singleAccountInstance: boolean;
  trovePath?: string;
  trovePathPts?: string;
  region?: string;
}

interface NormalAccount {
  email: string;
  password: string;
  username?: string;
  userId?: number;
  groupId?: string;
  order?: number;
}

interface Props {
  isLaunching: boolean;
  ingameNameMap?: Record<string, string>;
  onSettingsChange?: (settings: GlyphSettings) => void;
  onSessionsChange?: (emails: Set<string>) => void;
  onLoggedInAccountsChange?: (accounts: NormalAccount[]) => void;
  busyChannels?: Set<TroveChannel>;
}


const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const emailKey = (e: string) => e.trim().toLowerCase();

const maskEmail = (email: string): string => {
  const at = email.indexOf("@");
  if (at < 0) return email;
  return email.slice(0, Math.min(2, email.slice(0, at).length)) + "***" + email.slice(at);
};

function isFatalSessionError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes("banned") ||
    lower.includes("incorrect password") ||
    lower.includes("password was changed") ||
    lower.includes("account does not exist") ||
    lower.includes("expired") ||
    lower.includes("access denied") ||
    lower.includes("no saved session")
  );
}

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let val = bytes;
  let idx = 0;
  while (val >= 1024 && idx < units.length - 1) { val /= 1024; idx++; }
  return `${val.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
};

const getTicketExpirationMs = (detailsB64: string): number | null => {
  if (!detailsB64) return null;
  try {
    const m = atob(detailsB64).match(/expiration="([^"]+)"/);
    if (!m) return null;
    const ms = Date.parse(m[1]);
    return isNaN(ms) ? null : ms;
  } catch { return null; }
};

const formatExpiry = (ms: number | null): string => {
  if (ms == null) return "Expiry unknown";
  const diff = ms - Date.now();
  if (diff < 0) return "Expired";
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h >= 48) return `Expires in ${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `Expires in ${h}h ${m}m`;
  return `Expires in ${m}m`;
};


let _cachedAccounts: NormalAccount[] = [];
let _cachedSessions: Record<string, boolean> = {};
let _cachedSessionErrors: Record<string, string> = {};
let _cachedSessionFatalErrors: Record<string, boolean> = {};
let _cachedSessionExpiries: Record<string, number | null> = {};

function _syncSessionCache(
  sessions: Record<string, boolean>,
  errors: Record<string, string>,
  fatal: Record<string, boolean>,
  expiries: Record<string, number | null>,
) {
  _cachedSessions = { ...sessions };
  _cachedSessionErrors = { ...errors };
  _cachedSessionFatalErrors = { ...fatal };
  _cachedSessionExpiries = { ...expiries };
}


function AnimatedEyeIcon({ covered, className = "w-3.5 h-3.5" }: { covered: boolean; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
      <line x1="3" y1="3" x2="21" y2="21"
        strokeDasharray="25.46" strokeDashoffset={covered ? "0" : "25.46"}
        style={{ transition: "stroke-dashoffset 0.25s ease" }} />
    </svg>
  );
}

function PasswordInput({ id, value, onChange, placeholder = "password123!" }: {
  id: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input id={id} type={show ? "text" : "password"} placeholder={placeholder}
        value={value} onChange={e => onChange(e.target.value)}
        className="h-8 text-xs text-foreground pr-8 [&::-ms-reveal]:hidden [&::-ms-clear]:hidden" />
      <button type="button" onClick={() => setShow(s => !s)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground z-10" tabIndex={-1}>
        <AnimatedEyeIcon covered={!show} />
      </button>
    </div>
  );
}


const EMPTY_BUSY_CHANNELS: Set<TroveChannel> = new Set();

const GlyphSection = ({
  isLaunching, ingameNameMap = {},
  onSettingsChange,
  onSessionsChange, onLoggedInAccountsChange,
  busyChannels = EMPTY_BUSY_CHANNELS,
}: Props) => {
  const [accounts, setAccounts] = useState<NormalAccount[]>(_cachedAccounts);
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;

  const [trovePath, setTrovePath] = useState("");
  const [trovePathPts, setTrovePathPts] = useState("");
  const [injectorPath, setInjectorPath] = useState("");
  const [glyphRegion, setGlyphRegion] = useState("EU");
  const activeChannel: TroveChannel = glyphRegion === "PTS" ? "pts" : "live";
  const [autoRelog, setAutoRelog] = useState(false);
  const [singleInstance, setSingleInstance] = useState(true);
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [showEmails, setShowEmails] = useState(false);

  const [savedSessions, setSavedSessions] = useState<Record<string, boolean>>(_cachedSessions);
  const [sessionErrors, setSessionErrors] = useState<Record<string, string>>(_cachedSessionErrors);
  const [sessionFatalErrors, setSessionFatalErrors] = useState<Record<string, boolean>>(_cachedSessionFatalErrors);
  const [sessionExpiries, setSessionExpiries] = useState<Record<string, number | null>>(_cachedSessionExpiries);

  useEffect(() => {
    _syncSessionCache(savedSessions, sessionErrors, sessionFatalErrors, sessionExpiries);
  }, [savedSessions, sessionErrors, sessionFatalErrors, sessionExpiries]);

  useEffect(() => {
    if (accounts.length > 0) _cachedAccounts = accounts;
  }, [accounts]);

  const [loggingIn, setLoggingIn] = useState<Record<string, boolean>>({});
  const [touching, setTouching] = useState<Record<string, boolean>>({});
  const [starting, setStarting] = useState<Record<string, boolean>>({});
  const [injecting, setInjecting] = useState<Record<string, boolean>>({});

  const [searchAccountOpen, setSearchAccountOpen] = useState(false);
  const [searchAccountQuery, setSearchAccountQuery] = useState("");

  const filteredSearchAccounts = useMemo(() => {
    if (!searchAccountQuery.trim()) return accounts;
    const q = searchAccountQuery.trim().toLowerCase();
    return accounts.filter(a =>
      a.email.toLowerCase().includes(q) ||
      (a.username ?? "").toLowerCase().includes(q) ||
      String(a.userId ?? "").includes(q)
    );
  }, [accounts, searchAccountQuery]);

  const [addOpen, setAddOpen] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [addPassword, setAddPassword] = useState("");

  const addEmailError = useMemo(() => {
    if (!addOpen) return "";
    const email = addEmail.trim();
    if (!email) return "";
    if (!EMAIL_RE.test(email)) return "Valid email required";
    if (accounts.some(a => emailKey(a.email) === emailKey(email))) return "Account already exists";
    return "";
  }, [addEmail, accounts, addOpen]);

  const addValid = useMemo(() => {
    if (!addOpen) return false;
    return EMAIL_RE.test(addEmail.trim()) && addPassword.trim().length > 0 && !addEmailError;
  }, [addEmail, addPassword, addEmailError, addOpen]);

  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<NormalAccount | null>(null);
  const [editEmail, setEditEmail] = useState("");
  const [editPassword, setEditPassword] = useState("");

  const editEmailError = useMemo(() => {
    if (!editOpen) return "";
    const email = editEmail.trim();
    if (!email) return "";
    if (!EMAIL_RE.test(email)) return "Valid email required";
    if (accounts.some(a => ak(a) !== (editTarget ? ak(editTarget) : '') && emailKey(a.email) === emailKey(email))) return "Account already exists";
    return "";
  }, [editEmail, accounts, editTarget, editOpen]);

  const editValid = useMemo(() => {
    if (!editOpen) return false;
    return EMAIL_RE.test(editEmail.trim()) && editPassword.trim().length > 0 && !editEmailError;
  }, [editEmail, editPassword, editEmailError, editOpen]);

  const [deleteTarget, setDeleteTarget] = useState<NormalAccount | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [twoFaOpen, setTwoFaOpen] = useState(false);
  const [twoFaAccount, setTwoFaAccount] = useState<NormalAccount | null>(null);
  const [twoFaCode, setTwoFaCode] = useState("");
  const [twoFaError, setTwoFaError] = useState("");
  const [twoFaSubmitting, setTwoFaSubmitting] = useState(false);
  const [twoFaResending, setTwoFaResending] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);

  const [troveExeInfo, setTroveExeInfo] = useState<{ found: boolean; sizeBytes: number } | null>(null);
  const [troveExeInfoPts, setTroveExeInfoPts] = useState<{ found: boolean; sizeBytes: number } | null>(null);
  const [injectorExeInfo, setInjectorExeInfo] = useState<{ found: boolean; sizeBytes: number } | null>(null);
  const [manifestFound, setManifestFound] = useState<boolean | null>(null);
  const [manifestFoundPts, setManifestFoundPts] = useState<boolean | null>(null);

  const [troveUpdateInfo, setTroveUpdateInfo] = useState<{ upToDate: boolean; remoteVersion: string } | null>(null);
  const [troveUpdateInfoPts, setTroveUpdateInfoPts] = useState<{ upToDate: boolean; remoteVersion: string } | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [checkingUpdatePts, setCheckingUpdatePts] = useState(false);

  const [downloadingLive, setDownloadingLive] = useState(false);
  const [downloadingPts, setDownloadingPts] = useState(false);

  const [massSelected, setMassSelected] = useState<Set<string>>(new Set());

  const launchInFlightRef = useRef<Record<string, boolean>>({});
  const accountPidRef = useRef<Record<string, number>>({});
  const launchedPidToEmailRef = useRef<Record<number, string>>({});
  const prevLivePidsRef = useRef<Set<number>>(new Set());
  const relogInFlightRef = useRef<Record<string, boolean>>({});
  const relogCooldownRef = useRef<Record<string, number>>({});

  const [livePids, setLivePids] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const pids = Object.keys(launchedPidToEmailRef.current).map(Number);
      if (pids.length === 0) {
        if (!cancelled) setLivePids(prev => (prev.size === 0 ? prev : new Set()));
        return;
      }
      const results = await Promise.all(pids.map(async pid => {
        try { return await invoke<boolean>("is_pid_running", { pid }); } catch { return false; }
      }));
      if (cancelled) return;
      const next = new Set<number>();
      pids.forEach((pid, i) => { if (results[i]) next.add(pid); });
      setLivePids(next);
    };
    poll();
    const interval = setInterval(poll, 4000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const headerSentinelRef = useRef<HTMLDivElement>(null);
  const [headerScrolled, setHeaderScrolled] = useState(false);

  useEffect(() => {
    const sentinel = headerSentinelRef.current;
    if (!sentinel) return;
    let parent = sentinel.parentElement;
    let root: Element | null = null;
    while (parent) {
      const style = window.getComputedStyle(parent);
      if (style.overflowY === "auto" || style.overflowY === "scroll") {
        root = parent;
        break;
      }
      parent = parent.parentElement;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setHeaderScrolled(!entry.isIntersecting),
      { threshold: 0, root: root ?? undefined },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);


  useEffect(() => {
    const handler = () => { refreshSessions(); };
    window.addEventListener("glyph-sessions-changed", handler);
    return () => window.removeEventListener("glyph-sessions-changed", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadGlyphPrefsPd().then(p => {
      setAutoRelog(p.autoRelog ?? false);
      setSingleInstance(p.autoRelog ? true : (p.singleAccountInstance ?? true));
      setAutoUpdate(p.autoUpdate ?? false);
      setTrovePath(p.trovePath?.trim() ?? "");
      setTrovePathPts(p.trovePathPts?.trim() ?? "");
      setInjectorPath(p.injectorPath?.trim() ?? "");
      setGlyphRegion(p.region ?? "EU");
      onSettingsChange?.({
        autoRelog: p.autoRelog ?? false,
        singleAccountInstance: p.autoRelog ? true : (p.singleAccountInstance ?? true),
        trovePath: p.trovePath?.trim() ?? "",
        region: p.region ?? "EU",
      });
    }).catch(() => {});

    if (_cachedAccounts.length > 0) {
      const loggedInEmails = new Set(Object.keys(_cachedSessions));
      onSessionsChange?.(loggedInEmails);
      const loggedInAccts = _cachedAccounts.filter(a => _cachedSessions[emailKey(a.email)]);
      onLoggedInAccountsChange?.(loggedInAccts);
    }

    loadManualAccountsPd().then(loaded => {
      loadAccountGroups().then(currentGroups => {
        const existingGroupIds = new Set(currentGroups.map(g => g.id));
        let migrated = false;
        const normalized = loaded.map(a => {
          const next = { ...a };
          if (!next.groupId) { next.groupId = DEFAULT_GROUP_ID; migrated = true; }
          else if (next.groupId !== DEFAULT_GROUP_ID && !existingGroupIds.has(next.groupId)) {
            next.groupId = DEFAULT_GROUP_ID;
            next.order = 0;
            migrated = true;
          }
          return next;
        });
        const groupAccounts = new Map<string, typeof normalized>();
        for (const a of normalized) {
          const gid = a.groupId ?? DEFAULT_GROUP_ID;
          if (!groupAccounts.has(gid)) groupAccounts.set(gid, []);
          groupAccounts.get(gid)!.push(a);
        }
        for (const [, accts] of groupAccounts) {
          accts.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.userId ?? 0) - (b.userId ?? 0) || a.email.localeCompare(b.email));
          const orders = accts.map(a => a.order ?? 0);
          const hasCollision = new Set(orders).size < orders.length || orders.some(o => o === 0);
          if (hasCollision) {
            migrated = true;
            for (let i = 0; i < accts.length; i++) {
              accts[i].order = (i + 1) * 10;
            }
          }
        }
        if (migrated) {
          saveManualAccountsPd(normalized).catch(() => {});
        }
        _cachedAccounts = normalized;
        setAccounts(normalized);
        refreshSessions(normalized);
      }).catch(e => console.error("[INIT] loadAccountGroups FAILED:", e));
    }).catch(e => console.error("[INIT] loadManualAccountsPd FAILED:", e));

    (async () => {
      const p = await loadGlyphPrefsPd().catch(() => ({ trovePath: "", trovePathPts: "", injectorPath: "", region: "EU" } as any));
      const trove = p.trovePath?.trim();
      if (trove) inspectTroveExe(trove);
      const trovePts = p.trovePathPts?.trim();
      if (trovePts) inspectTroveExePts(trovePts);
      const injector = p.injectorPath?.trim();
      if (injector) inspectInjectorExe(injector);
    })();
  }, []);


  const persist = (accts: NormalAccount[]) => {
    _cachedAccounts = accts;
    setAccounts(accts);
    saveManualAccountsPd(accts).catch(e => console.error("[PERSIST] saveManualAccountsPd FAILED:", e));
  };


  const refreshSessions = async (accts?: NormalAccount[]) => {
    const list = accts ?? accountsRef.current;
    const sessions: Record<string, boolean> = {};
    const expiries: Record<string, number | null> = {};
    const errors: Record<string, string> = {};
    const fatal: Record<string, boolean> = {};
    for (const a of list) {
      try {
        const s = await getGlyphSessionPd(a.email);
        const ek = emailKey(a.email);
        if (s?.details_b64) {
          sessions[ek] = true;
          expiries[ek] = getTicketExpirationMs(s.details_b64);
          if (s.refresh_error) {
            errors[ek] = s.refresh_error;
            fatal[ek] = isFatalSessionError(s.refresh_error);
          }
        }
      } catch { }
    }
    setSavedSessions(sessions);
    setSessionErrors(errors);
    setSessionFatalErrors(fatal);
    setSessionExpiries(expiries);
    _syncSessionCache(sessions, errors, fatal, expiries);
    const keys = Object.keys(sessions);
    onSessionsChange?.(new Set(keys));
    const loggedInAccts = list.filter(a => sessions[emailKey(a.email)]);
    onLoggedInAccountsChange?.(loggedInAccts);
  };


  const persistLoginResult = async (
    account: NormalAccount,
    result: Awaited<ReturnType<typeof glyphAuth.loginAccount>>,
  ) => {
    await saveGlyphSessionPd(account.email, {
      details_b64: result.details_b64,
      saved_at_unix: result.saved_at_unix,
    });
    const ek = emailKey(account.email);
    setSessionErrors(p => { const n = { ...p }; delete n[ek]; return n; });
    setSessionFatalErrors(p => { const n = { ...p }; delete n[ek]; return n; });
    setSessionExpiries(p => ({ ...p, [ek]: getTicketExpirationMs(result.details_b64) }));

    const accountId = result.account_id ? parseInt(result.account_id, 10) : NaN;
    if (!isNaN(accountId) && accountId > 0) {
      const srcKey = ak(account);
      const conflicting = accountsRef.current.find(
        a => ak(a) !== srcKey && a.userId === accountId,
      );
      let updated = accountsRef.current.map(a => {
        if (ak(a) === srcKey) return { ...a, userId: accountId };
        if (conflicting && ak(a) === ak(conflicting)) {
          const { userId: _, ...rest } = a;
          return rest as NormalAccount;
        }
        return a;
      });
      persist(updated);
    }
    await refreshSessions();
  };

  const handleLogin = async (account: NormalAccount) => {
    const key = ak(account);
    setLoggingIn(p => ({ ...p, [key]: true }));
    try {
      const result = await glyphAuth.loginAccount({
        email: account.email, password: account.password,
      });
      if (result.trion_token_required?.toLowerCase().includes("email")) {
        setTwoFaAccount(account); setTwoFaCode(""); setTwoFaError(""); setTwoFaOpen(true);
        return;
      }
      const err = parseGlyphError(result);
      if (err) {
        toast({ title: "Login Failed", description: err, variant: "destructive" });
        return;
      }
      await persistLoginResult(account, result);
      toast({ title: "Login Successful", description: account.username || account.email });
    } catch (e) {
      toast({ title: "Login Failed", description: parseGlyphErrorString(String(e)), variant: "destructive" });
    } finally {
      setLoggingIn(p => ({ ...p, [key]: false }));
    }
  };

  const handleTouch = async (account: NormalAccount) => {
    const key = ak(account);
    const ek = emailKey(account.email);
    const session = await getGlyphSessionPd(account.email);
    if (!session?.details_b64) {
      toast({ title: "No Saved Session", description: "Login first.", variant: "destructive" });
      return;
    }
    setTouching(p => ({ ...p, [key]: true }));
    try {
      const result = await glyphAuth.touchAccount(session.details_b64);
      const err = parseGlyphError(result);
      if (err) {
        await setGlyphSessionErrorPd(account.email, err);
        setSessionErrors(p => ({ ...p, [ek]: err }));
        setSessionFatalErrors(p => ({ ...p, [ek]: isFatalSessionError(err) }));
        toast({ title: "Could Not Refresh Token", description: err, variant: "destructive" });
        return;
      }
      if (result.details_b64) {
        await saveGlyphSessionPd(account.email, {
          details_b64: result.details_b64,
          saved_at_unix: result.saved_at_unix,
        });
        setSessionErrors(p => { const n = { ...p }; delete n[ek]; return n; });
        setSessionFatalErrors(p => { const n = { ...p }; delete n[ek]; return n; });
        setSessionExpiries(p => ({
          ...p, [ek]: getTicketExpirationMs(result.details_b64),
        }));
        await refreshSessions();
      }
      toast({ title: "Session Refreshed", description: account.username || account.email });
    } catch (e) {
      const reason = parseGlyphErrorString(String(e));
      await setGlyphSessionErrorPd(account.email, reason).catch(() => {});
      setSessionErrors(p => ({ ...p, [ek]: reason }));
      setSessionFatalErrors(p => ({ ...p, [ek]: isFatalSessionError(reason) }));
      toast({ title: "Could Not Refresh Token", description: reason, variant: "destructive" });
    } finally {
      setTouching(p => ({ ...p, [key]: false }));
    }
  };


  const handleTwoFaSubmit = async () => {
    if (!twoFaAccount || !twoFaCode.trim()) return;
    setTwoFaSubmitting(true);
    setTwoFaError("");
    try {
      const result = await glyphAuth.loginAccount({
        email: twoFaAccount.email,
        password: twoFaAccount.password,
        authCode: twoFaCode.replace(/\D/g, ""),
      });
      const err = parseGlyphError(result);
      if (err) {
        setTwoFaError(err);
        toast({ title: "2FA Login Failed", description: err, variant: "destructive" });
        return;
      }
      await persistLoginResult(twoFaAccount, result);
      toast({ title: "Login Successful", description: twoFaAccount.username || twoFaAccount.email });
      setTwoFaOpen(false); setTwoFaAccount(null); setTwoFaCode(""); setTwoFaError("");
    } catch (e) {
      const msg = parseGlyphErrorString(String(e));
      setTwoFaError(msg);
      toast({ title: "2FA Login Failed", description: msg, variant: "destructive" });
    } finally {
      setTwoFaSubmitting(false);
    }
  };

  const handleTwoFaResend = async () => {
    if (!twoFaAccount) return;
    setTwoFaResending(true);
    try {
      await glyphAuth.resendAuthCode(twoFaAccount.email);
      toast({ title: "Code Resent", description: `Sent to ${twoFaAccount.email}` });
    } catch (e) {
      toast({ title: "Resend Failed", description: String(e), variant: "destructive" });
    } finally {
      setTwoFaResending(false);
    }
  };


  const isAlreadyRunning = async (account: NormalAccount): Promise<boolean> => {
    if (!singleInstance) return false;
    const aKey = ak(account);
    if (launchInFlightRef.current[aKey]) return true;
    for (const [pid, email] of Object.entries(launchedPidToEmailRef.current)) {
      if (emailKey(email) === emailKey(account.email) && livePids.has(Number(pid)))
        return true;
    }
    const lastPid = accountPidRef.current[aKey];
    if (lastPid) {
      try { return await invoke<boolean>("is_pid_running", { pid: lastPid }); } catch { }
    }
    return false;
  };

  const handleLaunch = async (account: NormalAccount) => {
    if (busyChannels.has(activeChannel)) {
      toast({ title: "Update In Progress", description: `${activeChannel.toUpperCase()} is updating - try again shortly.`, variant: "destructive" }); return;
    }
    if (!savedSessions[emailKey(account.email)]) {
      toast({ title: "No Session", description: "Login first.", variant: "destructive" }); return;
    }
    if (sessionFatalErrors[emailKey(account.email)]) {
      toast({ title: "Session Dead", description: "Session is expired or invalid. Please log in again.", variant: "destructive" }); return;
    }
    if (await isAlreadyRunning(account)) {
      toast({ title: "Already Running", variant: "destructive" }); return;
    }
    launchInFlightRef.current[ak(account)] = true;
    setStarting(p => ({ ...p, [ak(account)]: true }));
    try {
      const session = await getGlyphSessionPd(account.email);
      if (!session?.details_b64) throw new Error("Missing session");
      const pid = await glyphAuth.launchTrove(
        session.details_b64,
        (glyphRegion === "PTS" ? trovePathPts : trovePath).trim() || undefined,
        glyphRegion,
      );
      if (pid) {
        accountPidRef.current[ak(account)] = pid;
        launchedPidToEmailRef.current[pid] = account.email;
      }
    } catch (e) {
      toast({ title: "Launch Failed", description: String(e), variant: "destructive" });
    } finally {
      launchInFlightRef.current[ak(account)] = false;
      setStarting(p => ({ ...p, [ak(account)]: false }));
    }
  };

  const handleLaunchAndInject = async (account: NormalAccount) => {
    if (busyChannels.has(activeChannel)) {
      toast({ title: "Update In Progress", description: `${activeChannel.toUpperCase()} is updating - try again shortly.`, variant: "destructive" }); return;
    }
    if (!savedSessions[emailKey(account.email)]) {
      toast({ title: "No Session", description: "Login first.", variant: "destructive" }); return;
    }
    if (sessionFatalErrors[emailKey(account.email)]) {
      toast({ title: "Session Dead", description: "Session is expired or invalid. Please log in again.", variant: "destructive" }); return;
    }
    if (await isAlreadyRunning(account)) {
      toast({ title: "Already Running", variant: "destructive" }); return;
    }
    launchInFlightRef.current[ak(account)] = true;
    setInjecting(p => ({ ...p, [ak(account)]: true }));
    try {
      const session = await getGlyphSessionPd(account.email);
      if (!session?.details_b64) throw new Error("Missing session");
      const pid = await glyphAuth.launchGameWithSavedSession(
        session.details_b64,
        (glyphRegion === "PTS" ? trovePathPts : trovePath).trim() || undefined,
        account.email, singleInstance, glyphRegion,
        injectorPath.trim() || undefined,
      );
      if (pid) {
        accountPidRef.current[ak(account)] = pid;
        launchedPidToEmailRef.current[pid] = account.email;
      }
    } catch (e) {
      toast({ title: "Launch & Inject Failed", description: String(e), variant: "destructive" });
    } finally {
      launchInFlightRef.current[ak(account)] = false;
      setInjecting(p => ({ ...p, [ak(account)]: false }));
    }
  };


  const handleAdd = () => {
    if (!addValid) return;
    const email = addEmail.trim();
    const defaultOrders = accounts.filter(a => a.groupId === DEFAULT_GROUP_ID).map(a => a.order ?? 0);
    const minOrder = defaultOrders.length > 0 ? Math.min(...defaultOrders) : 0;
    const updated = [...accounts, {
      email,
      password: addPassword.trim(),
      groupId: DEFAULT_GROUP_ID,
      order: minOrder - 10,
    }];
    persist(updated);
    setAddEmail(""); setAddPassword(""); setAddOpen(false);
    toast({ title: "Account Added", description: email });
  };

  const handleEdit = () => {
    if (!editTarget || !editValid) return;
    const email = editEmail.trim();
    const oldKey = emailKey(editTarget.email);
    const newKey = emailKey(email);
    const editKey = ak(editTarget);
    const updated = accounts.map(a =>
      ak(a) === editKey
        ? { ...a, email, password: editPassword.trim() }
        : a,
    );
    persist(updated);
    if (oldKey !== newKey) removeGlyphSessionPd(editTarget.email).catch(() => {});
    setEditOpen(false); setEditTarget(null);
    refreshSessions();
  };

  const openEdit = (a: NormalAccount) => {
    setEditTarget(a); setEditEmail(a.email); setEditPassword(a.password);
    setEditOpen(true);
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    const delKey = ak(deleteTarget);
    const updated = accounts.filter(a => ak(a) !== delKey);
    persist(updated);

    toast({ title: "Account Deleted", description: deleteTarget.username || deleteTarget.email });


    setSavedSessions(p => { const n = { ...p }; delete n[emailKey(deleteTarget.email)]; return n; });
    setSessionErrors(p => { const n = { ...p }; delete n[emailKey(deleteTarget.email)]; return n; });
    setSessionFatalErrors(p => { const n = { ...p }; delete n[emailKey(deleteTarget.email)]; return n; });
    onSessionsChange?.(new Set(Object.keys(savedSessions).filter(k => k !== emailKey(deleteTarget.email))));
    onLoggedInAccountsChange?.(accounts.filter(a => ak(a) !== delKey && savedSessions[emailKey(a.email)] && emailKey(a.email) !== emailKey(deleteTarget.email)));
  };


  const saveSettings = (
    relog: boolean,
    single: boolean,
    tp = trovePath,
    region = glyphRegion,
    ip = injectorPath,
    ptsTp = trovePathPts,
    au = autoUpdate,
  ) => {
    const ns = relog ? true : single;
    saveGlyphPrefsPd({ trovePath: tp.trim(), trovePathPts: ptsTp.trim(), injectorPath: ip.trim(), autoRelog: relog, singleAccountInstance: ns, region, autoUpdate: au }).catch(() => {});
    onSettingsChange?.({ autoRelog: relog, singleAccountInstance: ns, trovePath: tp.trim(), trovePathPts: ptsTp.trim(), region });
  };

  const inspectTroveExe = async (path: string) => {
    try {
      const info = await invoke<{ sizeBytes: number }>("inspect_trove_executable_cmd", { path });
      setTroveExeInfo({ found: true, sizeBytes: info.sizeBytes });
    } catch {
      setTroveExeInfo({ found: false, sizeBytes: 0 });
    }
    hasLocalManifest(path).then(setManifestFound).catch(() => setManifestFound(false));
  };

  const inspectTroveExePts = async (path: string) => {
    try {
      const info = await invoke<{ sizeBytes: number }>("inspect_trove_executable_cmd", { path });
      setTroveExeInfoPts({ found: true, sizeBytes: info.sizeBytes });
    } catch {
      setTroveExeInfoPts({ found: false, sizeBytes: 0 });
    }
    hasLocalManifest(path).then(setManifestFoundPts).catch(() => setManifestFoundPts(false));
  };

  const handleDownloadGame = async (channel: TroveChannel) => {
    const folder = await open({
      directory: true, multiple: false,
      title: `Select install folder for Trove (${channel.toUpperCase()})`,
    }).catch(() => null);
    if (typeof folder !== "string" || !folder.trim()) return;

    const setDownloading = channel === "pts" ? setDownloadingPts : setDownloadingLive;
    setDownloading(true);
    try {
      const exePath = await downloadTroveFresh(folder, channel);
      if (channel === "pts") {
        setTrovePathPts(exePath);
        setTroveUpdateInfoPts(null);
        saveSettings(autoRelog, singleInstance, trovePath, glyphRegion, injectorPath, exePath);
        inspectTroveExePts(exePath);
      } else {
        setTrovePath(exePath);
        setTroveUpdateInfo(null);
        saveSettings(autoRelog, singleInstance, exePath);
        inspectTroveExe(exePath);
      }
      toast({ title: "Trove Installed", description: exePath });
    } catch (e) {
      toast({ title: "Download Failed", description: String(e), variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  };

  const inspectInjectorExe = async (path: string) => {
    try {
      const info = await invoke<{ sizeBytes: number }>("inspect_trove_executable_cmd", { path });
      setInjectorExeInfo({ found: true, sizeBytes: info.sizeBytes });
    } catch {
      setInjectorExeInfo({ found: false, sizeBytes: 0 });
    }
  };

  const handleCheckTroveUpdate = async () => {
    if (!trovePath.trim()) return;
    setCheckingUpdate(true);
    try {
      const result = await checkTroveUpdate(trovePath.trim(), "live");
      setTroveUpdateInfo({ upToDate: result.upToDate, remoteVersion: result.remoteVersion });
    } catch (e) {
      toast({ title: "Update Check Failed", description: String(e), variant: "destructive" });
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleCheckTroveUpdatePts = async () => {
    if (!trovePathPts.trim()) return;
    setCheckingUpdatePts(true);
    try {
      const result = await checkTroveUpdate(trovePathPts.trim(), "pts");
      setTroveUpdateInfoPts({ upToDate: result.upToDate, remoteVersion: result.remoteVersion });
    } catch (e) {
      toast({ title: "Update Check Failed", description: String(e), variant: "destructive" });
    } finally {
      setCheckingUpdatePts(false);
    }
  };

  const handleBrowseTrovePath = async () => {
    try {
      const selected = await open({
        multiple: false, title: "Select Trove_x64.exe",
        defaultPath: trovePath.trim() || undefined,
        filters: [{ name: "Trove executable", extensions: ["exe"] }],
      });
      if (typeof selected !== "string" || !selected.trim()) return;
      setTrovePath(selected);
      setTroveUpdateInfo(null);
      saveSettings(autoRelog, singleInstance, selected);
      inspectTroveExe(selected);
    } catch (e) {
      toast({ title: "Selection Failed", description: String(e), variant: "destructive" });
    }
  };

  const handleDetectTrovePath = async () => {
    try {
      const detected = (await invoke<string>("resolve_trove_exe_path_cmd", { trovePathOverride: null })).trim();
      setTrovePath(detected);
      setTroveUpdateInfo(null);
      saveSettings(autoRelog, singleInstance, detected);
      inspectTroveExe(detected);
      toast({ title: "Trove Executable Detected", description: detected });
    } catch (e) {
      toast({ title: "Detection Failed", description: String(e), variant: "destructive" });
    }
  };

  const handleClearTrovePath = () => {
    setTrovePath("");
    setTroveExeInfo(null);
    setTroveUpdateInfo(null);
    saveSettings(autoRelog, singleInstance, "");
    toast({ title: "Path Cleared", description: "Using auto-detect" });
  };

  const handleBrowseTrovePathPts = async () => {
    try {
      const selected = await open({
        multiple: false, title: "Select PTS Trove_x64.exe",
        defaultPath: trovePathPts.trim() || undefined,
        filters: [{ name: "Trove executable", extensions: ["exe"] }],
      });
      if (typeof selected !== "string" || !selected.trim()) return;
      setTrovePathPts(selected);
      setTroveUpdateInfoPts(null);
      saveSettings(autoRelog, singleInstance, trovePath, glyphRegion, injectorPath, selected);
      inspectTroveExePts(selected);
    } catch (e) {
      toast({ title: "Selection Failed", description: String(e), variant: "destructive" });
    }
  };

  const handleDetectTrovePathPts = async () => {
    try {
      const detected = (await invoke<string>("resolve_trove_pts_exe_path_cmd")).trim();
      setTrovePathPts(detected);
      setTroveUpdateInfoPts(null);
      saveSettings(autoRelog, singleInstance, trovePath, glyphRegion, injectorPath, detected);
      inspectTroveExePts(detected);
      toast({ title: "PTS Executable Detected", description: detected });
    } catch (e) {
      toast({ title: "Detection Failed", description: String(e), variant: "destructive" });
    }
  };

  const handleClearTrovePathPts = () => {
    setTrovePathPts("");
    setTroveExeInfoPts(null);
    setTroveUpdateInfoPts(null);
    saveSettings(autoRelog, singleInstance, trovePath, glyphRegion, injectorPath, "");
    toast({ title: "Path Cleared", description: "Using auto-detect" });
  };

  const handleBrowseInjectorPath = async () => {
    try {
      const selected = await open({
        multiple: false, title: "Select Injector-x64.exe",
        defaultPath: injectorPath.trim() || undefined,
        filters: [{ name: "Injector executable", extensions: ["exe"] }],
      });
      if (typeof selected !== "string" || !selected.trim()) return;
      setInjectorPath(selected);
      saveSettings(autoRelog, singleInstance, trovePath, glyphRegion, selected);
      inspectInjectorExe(selected);
    } catch (e) {
      toast({ title: "Selection Failed", description: String(e), variant: "destructive" });
    }
  };

  const handleClearInjectorPath = () => {
    setInjectorPath("");
    setInjectorExeInfo(null);
    saveSettings(autoRelog, singleInstance, trovePath, glyphRegion, "");
    toast({ title: "Path Cleared", description: "Using default (next to launcher)" });
  };


  useEffect(() => {
    if (!autoRelog || busyChannels.has(activeChannel)) return;
    const now = Date.now();
    const currentPids = livePids;

    for (const [numPid, email] of Object.entries(launchedPidToEmailRef.current)) {
      const pid = Number(numPid);
      const wasLive = prevLivePidsRef.current.has(pid);
      const isLive = currentPids.has(pid);
      if (!wasLive || isLive) continue;

      const normal = accountsRef.current.find(a => emailKey(a.email) === emailKey(email));
      if (!normal || !savedSessions[emailKey(email)]) continue;

      const lk = emailKey(email);
      if (relogInFlightRef.current[lk]) continue;
      if (now - (relogCooldownRef.current[lk] ?? 0) < 5000) continue;

      const nKey = ak(normal);
      relogInFlightRef.current[lk] = true;
      relogCooldownRef.current[lk] = now;
      launchInFlightRef.current[nKey] = true;

      (async () => {
        try {
          const session = await getGlyphSessionPd(normal.email);
          if (!session?.details_b64) throw new Error("Missing session");
          const newPid = await glyphAuth.launchGameWithSavedSession(
            session.details_b64,
            (glyphRegion === "PTS" ? trovePathPts : trovePath).trim() || undefined,
            normal.email, true, glyphRegion,
            injectorPath.trim() || undefined,
          );
          delete launchedPidToEmailRef.current[pid];
          if (newPid) {
            accountPidRef.current[nKey] = newPid;
            launchedPidToEmailRef.current[newPid] = normal.email;
            prevLivePidsRef.current = new Set([...prevLivePidsRef.current, newPid]);
          }
          toast({ title: "Auto Relog", description: normal.username || normal.email });
        } catch (e) {
          toast({ title: "Auto Relog Failed", description: normal.username || normal.email, variant: "destructive" });
        } finally {
          relogInFlightRef.current[lk] = false;
          launchInFlightRef.current[nKey] = false;
        }
      })();
    }
    prevLivePidsRef.current = currentPids;
  }, [livePids, autoRelog]);


  const displayRows: DisplayRow[] = accounts.map(a => {
    const aid = a.userId ?? 0;
    const lastPid = accountPidRef.current[ak(a)];
    return {
      email: a.email,
      username: a.username || "",
      accountId: aid,
      isLive: !!lastPid && livePids.has(lastPid),
      isLoggedIn: !!savedSessions[emailKey(a.email)],
      groupId: a.groupId,
      order: a.order,
    };
  });

  const [accountGroups, setAccountGroups] = useState<AccountGroup[]>([]);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<AccountGroup | null>(null);
  const [deleteGroupOpen, setDeleteGroupOpen] = useState(false);

  useEffect(() => {
    loadAccountGroups().then(setAccountGroups).catch(() => {});
  }, []);

  const persistGroups = (grps: AccountGroup[]) => {
    setAccountGroups(grps);
    saveAccountGroups(grps).catch(() => {});
  };

  const defaultGroup: AccountGroup = accountGroups.find(g => g.id === DEFAULT_GROUP_ID) ?? {
    id: DEFAULT_GROUP_ID, name: DEFAULT_GROUP_NAME, order: -1, collapsed: false,
  };

  const groupedData: Array<{ group: AccountGroup; rows: DisplayRow[]; isDefault?: boolean }> = [
    {
      group: defaultGroup,
      rows: displayRows
        .filter(r => !r.groupId || r.groupId === DEFAULT_GROUP_ID)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.accountId || 0) - (b.accountId || 0) || a.email.localeCompare(b.email)),
      isDefault: true as const,
    },
    ...accountGroups
      .filter(g => g.id !== DEFAULT_GROUP_ID)
      .map(group => ({
        group,
        rows: displayRows
          .filter(r => r.groupId === group.id)
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.accountId || 0) - (b.accountId || 0) || a.email.localeCompare(b.email)),
      })),
  ];


  type DragPayload =
    | { kind: "account"; row: DisplayRow }
    | { kind: "group"; group: AccountGroup };

  type DropTarget =
    | { kind: "group"; groupId: string; targetAccountId?: string; insertBefore?: boolean }
    | null;

  const [dragPayload, setDragPayload] = useState<DragPayload | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [groupDropIndex, setGroupDropIndex] = useState<number | null>(null);
  const groupDropIndexRef = useRef(groupDropIndex);
  groupDropIndexRef.current = groupDropIndex;
  const dropTargetRef = useRef(dropTarget);
  dropTargetRef.current = dropTarget;
  const payloadRef = useRef(dragPayload);
  payloadRef.current = dragPayload;
  const groupsRef = useRef(accountGroups);
  groupsRef.current = accountGroups;
  const ghostRef = useRef<HTMLDivElement>(null);
  const ghostSizeRef = useRef({ w: 140, h: 28 });

  useEffect(() => {
    if (!dragPayload) return;

    const handleMouseMove = (e: MouseEvent) => {
      setDragPos({ x: e.clientX, y: e.clientY });

      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el) { setDropTarget(null); return; }

      const accountRow = el.closest("[data-drop-account]") as HTMLElement | null;
      const groupContainer = el.closest("[data-drop-group]") as HTMLElement | null;

      if (payloadRef.current?.kind === "group") {
        if (groupContainer) {
          const gid = groupContainer.getAttribute("data-drop-group") || "";
          if (gid === DEFAULT_GROUP_ID) { setGroupDropIndex(null); return; }
          const idx = groupedData.findIndex(g => g.group.id === gid);
          if (idx > 0) {
            const rect = groupContainer.getBoundingClientRect();
            const before = e.clientY < rect.top + rect.height / 2;
            setGroupDropIndex(before ? idx : idx + 1);
          }
        } else {
          const lastGroup = document.querySelector("[data-drop-group]:last-of-type");
          if (lastGroup) {
            const lastRect = lastGroup.getBoundingClientRect();
            setGroupDropIndex(e.clientY > lastRect.bottom ? groupedData.length : null);
          } else {
            setGroupDropIndex(null);
          }
        }
        return;
      }

      if (accountRow) {
        const targetId = accountRow.getAttribute("data-drop-account") || "";
        const rect = accountRow.getBoundingClientRect();
        const insertBefore = e.clientY < rect.top + rect.height / 2;

        if (groupContainer) {
          const gid = groupContainer.getAttribute("data-drop-group") || "";
          setDropTarget({ kind: "group", groupId: gid, targetAccountId: targetId, insertBefore });
        }
        return;
      }

      if (groupContainer) {
        const gid = groupContainer.getAttribute("data-drop-group");
        if (gid) { setDropTarget({ kind: "group", groupId: gid }); return; }
      }

      setDropTarget(null);
    };

    const handleMouseUp = (_e: MouseEvent) => {
      const payload = payloadRef.current;
      const target = dropTargetRef.current;
      if (!payload) { cancelDrag(); return; }

      if (payload.kind === "account") {
        const srcId = ak(payload.row);
        if (target?.targetAccountId === srcId) {
          cancelDrag();
          return;
        }
        if (target?.kind === "group") {
          moveAccountToGroup(srcId, target.groupId, target.targetAccountId, target.insertBefore);
        }
      } else if (payload.kind === "group") {
        const groups = groupsRef.current;
        const dropIdx = groupDropIndexRef.current;
        if (dropIdx !== null && dropIdx > 0) {
          const draggedIdx = groups.findIndex(g => g.id === payload.group.id);
          const adjustedIdx = draggedIdx >= 0 && dropIdx > draggedIdx ? dropIdx - 1 : dropIdx;
          handleGroupReorder(payload.group.id, adjustedIdx);
        }
      }

      cancelDrag();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelDrag();
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("keydown", handleKeyDown);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragPayload]);

  useLayoutEffect(() => {
    if (dragPayload && ghostRef.current) {
      const r = ghostRef.current.getBoundingClientRect();
      ghostSizeRef.current = { w: Math.ceil(r.width), h: Math.ceil(r.height) };
    }
  });

  const cancelDrag = () => {
    setDragPayload(null);
    setDropTarget(null);
    setGroupDropIndex(null);
  };

  const startAccountDrag = (e: React.MouseEvent, row: DisplayRow) => {
    e.stopPropagation();
    e.preventDefault();
    setDragPayload({ kind: "account", row });
    setDragPos({ x: e.clientX, y: e.clientY });
  };

  const startGroupDrag = (e: React.MouseEvent, group: AccountGroup) => {
    if (group.id === DEFAULT_GROUP_ID) return;
    e.stopPropagation();
    e.preventDefault();
    setDragPayload({ kind: "group", group });
    setDragPos({ x: e.clientX, y: e.clientY });
  };

  const moveAccountToGroup = (
    accountKeyStr: string,
    targetGroupId: string | undefined,
    targetAccountId?: string,
    insertBefore?: boolean,
  ) => {
    setAccounts(prev => {
      const targetAccounts = prev
        .filter(a => {
          const inGroup = targetGroupId === DEFAULT_GROUP_ID
            ? (!a.groupId || a.groupId === DEFAULT_GROUP_ID)
            : a.groupId === targetGroupId;
          return inGroup && ak(a) !== accountKeyStr;
        })
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.userId ?? 0) - (b.userId ?? 0) || a.email.localeCompare(b.email));

      const DEFAULT_GAP = 10;

      let insertOrder: number;

      if (targetAccounts.length === 0) {
        insertOrder = DEFAULT_GAP;
      } else if (targetAccountId) {
        const targetIdx = targetAccounts.findIndex(a => ak(a) === targetAccountId);
        if (targetIdx < 0) {
          insertOrder = (targetAccounts[targetAccounts.length - 1].order ?? 0) + DEFAULT_GAP;
        } else if (insertBefore) {
          const beforeOrder = targetIdx > 0
            ? (targetAccounts[targetIdx - 1].order ?? 0)
            : 0;
          const targetOrder = targetAccounts[targetIdx].order ?? beforeOrder + DEFAULT_GAP;
          insertOrder = beforeOrder > 0
            ? Math.floor((beforeOrder + targetOrder) / 2)
            : Math.floor(targetOrder / 2);
          if (insertOrder <= 0) insertOrder = 1;
        } else {
          const targetOrder = targetAccounts[targetIdx].order ?? 0;
          const afterOrder = targetIdx + 1 < targetAccounts.length
            ? (targetAccounts[targetIdx + 1].order ?? targetOrder + DEFAULT_GAP)
            : targetOrder + DEFAULT_GAP;
          insertOrder = Math.floor((targetOrder + afterOrder) / 2);
          if (insertOrder <= targetOrder) insertOrder = targetOrder + 1;
        }
      } else {
        insertOrder = (targetAccounts[targetAccounts.length - 1].order ?? 0) + DEFAULT_GAP;
      }

      const next = prev.map(a =>
        ak(a) === accountKeyStr
          ? { ...a, groupId: targetGroupId, order: insertOrder }
          : a,
      );
      _cachedAccounts = next;
      saveManualAccountsPd(next).catch(() => {});
      return next;
    });
  };

  const handleGroupReorder = (draggedGroupId: string, targetIndex: number) => {
    const dragged = accountGroups.find(g => g.id === draggedGroupId);
    if (!dragged) return;
    const filtered = accountGroups.filter(g => g.id !== draggedGroupId);
    const newGroups = [
      ...filtered.slice(0, targetIndex),
      dragged,
      ...filtered.slice(targetIndex),
    ].map((g, i) => ({ ...g, order: i * 10 }));
    persistGroups(newGroups);
  };

  const dragLabel = dragPayload
    ? dragPayload.kind === "account"
      ? (dragPayload.row.username || dragPayload.row.email)
      : dragPayload.group.name
    : "";

  const getDropIndicator = (rowKey: string): "above" | "below" | undefined => {
    if (!dragPayload || dragPayload.kind !== "account") return undefined;
    if (!dropTarget?.targetAccountId) return undefined;
    if (dropTarget.targetAccountId !== rowKey) return undefined;
    return dropTarget.insertBefore ? "above" : "below";
  };


  const handleCreateGroup = () => {
    const name = newGroupName.trim().slice(0, 64).toUpperCase();
    if (!name) return;
    const maxOrder = accountGroups.reduce((max, g) => Math.max(max, g.order), 0);
    const newGroup: AccountGroup = {
      id: `grp_${Date.now()}`,
      name,
      order: maxOrder + 10,
      collapsed: false,
    };
    persistGroups([...accountGroups, newGroup]);
    setNewGroupName("");
    setCreatingGroup(false);
  };

  const handleRenameGroup = (group: AccountGroup) => {
    const name = editingGroupName.trim().slice(0, 64).toUpperCase();
    if (!name) return;
    persistGroups(accountGroups.map(g => g.id === group.id ? { ...g, name } : g));
    setEditingGroupId(null);
  };

  const handleDeleteGroup = () => {
    if (!deleteGroupTarget) return;
    const next = accounts.map(a =>
      a.groupId === deleteGroupTarget.id ? { ...a, groupId: DEFAULT_GROUP_ID, order: 0 } : a,
    );
    const nextGroups = accountGroups.filter(g => g.id !== deleteGroupTarget.id);
    _cachedAccounts = next;
    setAccounts(next);
    setAccountGroups(nextGroups);
    saveManualAccountsPd(next)
      .then(() => saveAccountGroups(nextGroups))
      .catch(() => {});
  };

  const toggleGroupCollapse = (groupId: string) => {
    persistGroups(accountGroups.map(g => g.id === groupId ? { ...g, collapsed: !g.collapsed } : g));
  };


  return (
    <TooltipProvider delayDuration={400} disableHoverableContent>
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center">
          <Zap className="w-4 h-4 text-primary" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-foreground">Account List</h2>
          <p className="text-[11px] text-muted-foreground">Account management and automation</p>
        </div>
      </div>

      <div>
        <div ref={headerSentinelRef} className="h-0 w-full" />
        <div className="flex items-center justify-between mb-1 relative z-[6]">
          <p className="section-label">Groups</p>
        </div>
        <div className="sticky top-0 z-20 flex justify-end -mt-[38px] mb-1">
          <div className={`flex items-center gap-0.5 px-0.5 py-0.5 rounded-md transition-all duration-200 ${headerScrolled ? "bg-popover shadow-sm" : ""}`}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={() => setAddOpen(true)} variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground">
                  <Plus className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Add account</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={() => { setSearchAccountOpen(true); setSearchAccountQuery(""); }} variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground">
                  <Search className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Search accounts</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={() => setShowEmails(v => !v)} variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground">
                  <AnimatedEyeIcon covered={!showEmails} className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{showEmails ? "Hide emails" : "Show emails"}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={() => setSettingsOpen(true)} variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground">
                  <Settings className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Glyph settings</TooltipContent>
            </Tooltip>
            <IconLegend />
          </div>
        </div>

        {displayRows.length === 0 ? (
          <div className="rounded-lg bg-secondary/50 p-5 text-center">
            <p className="text-xs text-muted-foreground">No accounts yet</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Add an account or login to Glyph
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {headerScrolled && (
              <div className="sticky top-0 z-[5] w-full h-0 pointer-events-auto">
                <div className="absolute -bottom-6 -left-0.5 -right-0.5 bg-card" style={{ height: '10vh' }} />
              </div>
            )}
            {groupedData.map(({ group, rows, isDefault }, groupIndex) => (
              <div key={group.id}>
                {groupDropIndex === groupIndex && (
                  <div className="relative h-0 z-10 pointer-events-none">
                    <div className="absolute left-2 right-2 -top-[2.5px] h-[3px] rounded-full bg-primary shadow-[0_0_6px_rgba(59,130,246,0.5)]" />
                  </div>
                )}
                <div
                  data-drop-group={group.id}
                  className={`rounded-md transition-colors ${dropTarget?.kind === "group" && dropTarget.groupId === group.id && dragPayload?.kind !== "group" ? "bg-primary/10 ring-1 ring-primary/30" : ""} ${!group.collapsed ? "ring-1 ring-border/40" : ""}`}
                >
                <div className={`sticky top-[1px] z-10 bg-card rounded-t-md w-[calc(100%+2px)] -ml-px -translate-y-px flex items-center gap-1 pl-1.5 h-7 select-none border border-b-0 ${!group.collapsed ? "border-border/40" : "border-transparent"} ${isDefault ? "" : "group/grp-header"}`}>
                  <button type="button" className="flex items-center gap-1.5 flex-1 min-w-0"
                    onClick={() => {
                      if (editingGroupId === group.id) return;
                      toggleGroupCollapse(group.id);
                    }}>
                    <ChevronDown className={`w-3 h-3 text-muted-foreground shrink-0 transition-transform duration-200 ${!group.collapsed ? "rotate-0" : "-rotate-90"}`} />
                    {editingGroupId === group.id ? (
                      <input
                        value={editingGroupName}
                        onChange={e => setEditingGroupName(e.target.value.slice(0, 64))}
                        maxLength={64}
                        onKeyDown={e => {
                          if (e.key === "Enter") handleRenameGroup(group);
                          if (e.key === "Escape") setEditingGroupId(null);
                        }}
                        onBlur={() => handleRenameGroup(group)}
                        autoFocus
                        className="h-5 px-1 text-[11px] font-medium uppercase tracking-wide bg-background border border-border rounded text-foreground flex-1 min-w-0 outline-none"
                        onClick={e => e.stopPropagation()}
                      />
                    ) : (
                      <span className={`text-[10px] uppercase tracking-wide font-medium truncate ${isDefault ? "text-muted-foreground/50" : "text-muted-foreground/70"}`}>
                        {group.name}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground/50">({rows.length})</span>
                  </button>
                  {!isDefault && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          onMouseDown={e => startGroupDrag(e, group)}
                          className="shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/60 hover:text-foreground transition-all duration-200 opacity-0 group-hover/grp-header:opacity-100"
                          onClick={e => e.stopPropagation()}
                        >
                          <GripVertical className="w-3 h-3" />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>Drag to reorder groups</TooltipContent>
                    </Tooltip>
                  )}
                  {!isDefault && (
                    <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover/grp-header:opacity-100 transition-opacity duration-200" onClick={e => e.stopPropagation()}>
                      {editingGroupId !== group.id && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => { setEditingGroupId(group.id); setEditingGroupName(group.name); }}
                              className="h-4 w-4 p-0 text-muted-foreground hover:text-foreground rounded flex items-center justify-center"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-2.5 h-2.5">
                                <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                              </svg>
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>Rename group</TooltipContent>
                        </Tooltip>
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => { setDeleteGroupTarget(group); setDeleteGroupOpen(true); }}
                            className="h-4 w-4 p-0 text-muted-foreground hover:text-destructive rounded flex items-center justify-center"
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Delete group</TooltipContent>
                      </Tooltip>
                    </div>
                  )}
                </div>

                <div className="overflow-hidden" style={{
                  display: "grid", gridTemplateRows: !group.collapsed ? "1fr" : "0fr",
                  transition: "grid-template-rows 0.2s ease",
                }}>
                  <div className="min-h-0">
                    <div className="space-y-0.5 pl-2">
                      {rows.map((row, idx) => (
                        <AccountRow
                          key={ak(row)}
                          row={row}
                          rowIndex={idx}
                          account={accounts.find(a => ak(a) === ak(row))!}
                          showEmails={showEmails}
                          isLaunching={isLaunching}
                          ingameNameMap={ingameNameMap}
                          sessionErrors={sessionErrors}
                          sessionFatalErrors={sessionFatalErrors}
                          sessionExpiries={sessionExpiries}
                          loggingIn={loggingIn}
                          touching={touching}
                          starting={starting}
                          injecting={injecting}
                          massSelected={massSelected}
                          massEnabled={SHOW_SELECT_BUTTON}
                          isDragging={dragPayload?.kind === "account" && ak(dragPayload.row) === ak(row)}
                          dropIndicator={getDropIndicator(ak(row))}
                          onEdit={openEdit}
                          onDelete={a => { setDeleteTarget(a); setDeleteOpen(true); }}
                          onLogin={handleLogin}
                          onTouch={handleTouch}
                          onLaunch={handleLaunch}
                          onLaunchAndInject={handleLaunchAndInject}
                          onSelect={manualId => setMassSelected(p => {
                            const n = new Set(p);
                            p.has(manualId) ? n.delete(manualId) : n.add(manualId);
                            return n;
                          })}
                          onDragStart={startAccountDrag}
                        />
                      ))}
                      {rows.length === 0 && (
                        <p className="text-[10px] text-muted-foreground/50 italic py-1">
                          Drop accounts here
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              </div>
            ))}

            {groupDropIndex === groupedData.length && (
              <div className="relative h-0 z-10 pointer-events-none">
                <div className="absolute left-2 right-2 -top-[2.5px] h-[3px] rounded-full bg-primary shadow-[0_0_6px_rgba(59,130,246,0.5)]" />
              </div>
            )}

            {creatingGroup ? (
              <div className="flex items-center gap-1 py-1">
                <input
                  value={newGroupName}
                  onChange={e => setNewGroupName(e.target.value)}
                  maxLength={64}
                  onKeyDown={e => {
                    if (e.key === "Enter") handleCreateGroup();
                    if (e.key === "Escape") { setCreatingGroup(false); setNewGroupName(""); }
                  }}
                  placeholder="Group name..."
                  autoFocus
                  className="h-6 px-2 text-[11px] bg-background border border-border rounded text-foreground flex-1 min-w-0 outline-none"
                />
                <button onClick={handleCreateGroup} className="h-6 px-2 text-[10px] bg-primary text-primary-foreground rounded hover:bg-primary/80">
                  Create
                </button>
                <button onClick={() => { setCreatingGroup(false); setNewGroupName(""); }} className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground rounded flex items-center justify-center">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setCreatingGroup(true)}
                className="flex items-center gap-1.5 w-full py-1 text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
              >
                <Plus className="w-3 h-3" />
                <span>Create Group</span>
              </button>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog open={settingsOpen} onOpenChange={setSettingsOpen}
        title="Account Settings"
        actions={[]}
        description={
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                Automation
              </p>
              <div className="setting-row">
                <div>
                  <p className="text-xs font-medium text-foreground">Auto Relog</p>
                  <p className="text-[11px] text-muted-foreground">
                    Relaunch when the process closes
                  </p>
                </div>
                <Switch checked={autoRelog} onCheckedChange={v => {
                  setAutoRelog(v);
                  if (v) setSingleInstance(true);
                  saveSettings(v, v ? true : singleInstance);
                }} />
              </div>
              <div className="setting-row">
                <div>
                  <p className="text-xs font-medium text-foreground">
                    Single Account Instance
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    One instance per account
                  </p>
                </div>
                <Switch checked={singleInstance} disabled={autoRelog}
                  onCheckedChange={v => {
                    setSingleInstance(v); saveSettings(autoRelog, v);
                  }} />
              </div>
              <div className="setting-row">
                <div>
                  <p className="text-xs font-medium text-foreground">Auto Update</p>
                  <p className="text-[11px] text-muted-foreground">
                    Install Trove updates automatically when found
                  </p>
                </div>
                <Switch checked={autoUpdate} onCheckedChange={v => {
                  setAutoUpdate(v);
                  saveSettings(autoRelog, singleInstance, trovePath, glyphRegion, injectorPath, trovePathPts, v);
                }} />
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                Trove Executable (Live)
              </p>
              <div className="flex items-center gap-1.5">
                <Input value={trovePath} placeholder="Auto-detect" readOnly title={trovePath || undefined}
                  className="h-7 text-[11px] flex-1 min-w-0 truncate bg-muted/40 font-mono" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 w-7 p-0"
                      onClick={handleBrowseTrovePath}>
                      <FolderOpen className="w-3 h-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Browse...</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 w-7 p-0"
                      onClick={handleDetectTrovePath}>
                      <Search className="w-3 h-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Auto-detect</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 w-7 p-0"
                      onClick={handleClearTrovePath} disabled={!trovePath.trim()}>
                      <X className="w-3 h-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Clear</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 w-7 p-0"
                      onClick={handleCheckTroveUpdate} disabled={!trovePath.trim() || checkingUpdate}>
                      <RefreshCw className={`w-3 h-3 ${checkingUpdate ? "animate-spin" : ""}`} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Check for updates</TooltipContent>
                </Tooltip>
              </div>
              {trovePath.trim() ? (
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-medium ${
                    troveExeInfo === null ? "text-muted-foreground/50" :
                    troveExeInfo.found ? "text-emerald-400" : "text-destructive/70"
                  }`}>
                    {troveExeInfo === null ? "…" : troveExeInfo.found ? `Found · ${formatBytes(troveExeInfo.sizeBytes)}` : "Not found"}
                  </span>
                  {troveUpdateInfo && (
                    <span className={`text-[10px] font-medium ${troveUpdateInfo.upToDate ? "text-emerald-400" : "text-amber-400"}`}>
                      {troveUpdateInfo.upToDate ? "Up to date" : `Update available (${troveUpdateInfo.remoteVersion})`}
                    </span>
                  )}
                  {manifestFound === false && (
                    <span className="text-[10px] font-medium text-amber-400">No install record</span>
                  )}
                </div>
              ) : null}
              {(!trovePath.trim() || manifestFound === false) && (
                <Button variant="outline" size="sm" className="h-6 text-[11px] px-2"
                  onClick={() => handleDownloadGame("live")} disabled={downloadingLive}>
                  <Download className={`w-3 h-3 mr-1 ${downloadingLive ? "animate-pulse" : ""}`} />
                  {downloadingLive ? "Downloading…" : "Download Game"}
                </Button>
              )}
            </div>

            <div className="space-y-1.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                Trove Executable (PTS)
              </p>
              <div className="flex items-center gap-1.5">
                <Input value={trovePathPts} placeholder="Auto-detect" readOnly title={trovePathPts || undefined}
                  className="h-7 text-[11px] flex-1 min-w-0 truncate bg-muted/40 font-mono" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 w-7 p-0"
                      onClick={handleBrowseTrovePathPts}>
                      <FolderOpen className="w-3 h-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Browse...</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 w-7 p-0"
                      onClick={handleDetectTrovePathPts}>
                      <Search className="w-3 h-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Auto-detect</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 w-7 p-0"
                      onClick={handleClearTrovePathPts} disabled={!trovePathPts.trim()}>
                      <X className="w-3 h-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Clear</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 w-7 p-0"
                      onClick={handleCheckTroveUpdatePts} disabled={!trovePathPts.trim() || checkingUpdatePts}>
                      <RefreshCw className={`w-3 h-3 ${checkingUpdatePts ? "animate-spin" : ""}`} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Check for updates</TooltipContent>
                </Tooltip>
              </div>
              {trovePathPts.trim() ? (
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-medium ${
                    troveExeInfoPts === null ? "text-muted-foreground/50" :
                    troveExeInfoPts.found ? "text-emerald-400" : "text-destructive/70"
                  }`}>
                    {troveExeInfoPts === null ? "…" : troveExeInfoPts.found ? `Found · ${formatBytes(troveExeInfoPts.sizeBytes)}` : "Not found"}
                  </span>
                  {troveUpdateInfoPts && (
                    <span className={`text-[10px] font-medium ${troveUpdateInfoPts.upToDate ? "text-emerald-400" : "text-amber-400"}`}>
                      {troveUpdateInfoPts.upToDate ? "Up to date" : `Update available (${troveUpdateInfoPts.remoteVersion})`}
                    </span>
                  )}
                  {manifestFoundPts === false && (
                    <span className="text-[10px] font-medium text-amber-400">No install record</span>
                  )}
                </div>
              ) : null}
              {(!trovePathPts.trim() || manifestFoundPts === false) && (
                <Button variant="outline" size="sm" className="h-6 text-[11px] px-2"
                  onClick={() => handleDownloadGame("pts")} disabled={downloadingPts}>
                  <Download className={`w-3 h-3 mr-1 ${downloadingPts ? "animate-pulse" : ""}`} />
                  {downloadingPts ? "Downloading…" : "Download Game"}
                </Button>
              )}
            </div>

            <div className="space-y-1.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                Injector Executable
              </p>
              <div className="flex items-center gap-1.5">
                <Input value={injectorPath} placeholder="Next to launcher (default)" readOnly title={injectorPath || undefined}
                  className="h-7 text-[11px] flex-1 min-w-0 truncate bg-muted/40 font-mono" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 w-7 p-0"
                      onClick={handleBrowseInjectorPath}>
                      <FolderOpen className="w-3 h-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Browse...</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 w-7 p-0"
                      onClick={handleClearInjectorPath} disabled={!injectorPath.trim()}>
                      <X className="w-3 h-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Clear</TooltipContent>
                </Tooltip>
              </div>
              {injectorPath.trim() && (
                <span className={`text-[10px] font-medium ${
                  injectorExeInfo === null ? "text-muted-foreground/50" :
                  injectorExeInfo.found ? "text-emerald-400" : "text-destructive/70"
                }`}>
                  {injectorExeInfo === null ? "…" : injectorExeInfo.found ? `Found · ${formatBytes(injectorExeInfo.sizeBytes)}` : "Not found"}
                </span>
              )}
            </div>

            <div className="space-y-1.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                Region
              </p>
              <Select value={glyphRegion} onValueChange={v => {
                setGlyphRegion(v); saveSettings(autoRelog, singleInstance, trovePath, v);
              }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent className="z-[9999]">
                  <SelectItem value="EU">Europe (EU)</SelectItem>
                  <SelectItem value="NA">North America (NA)</SelectItem>
                  <SelectItem value="PTS">Public Test (PTS)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        }
      />

      <ConfirmDialog
        open={deleteGroupOpen}
        onOpenChange={o => { if (!o) setDeleteGroupOpen(false); }}
        title="Delete Group"
        description={
          deleteGroupTarget
            ? `Delete group "${deleteGroupTarget.name}"? Accounts in this group will be moved to uncategorized.`
            : ""
        }
        actions={[{
          label: "Delete", onClick: handleDeleteGroup,
          className: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        }]}
      />

      <ConfirmDialog open={addOpen}
        onOpenChange={o => {
          setAddOpen(o);
          if (!o) { setAddEmail(""); setAddPassword(""); }
        }}
        onCancel={() => { setAddEmail(""); setAddPassword(""); }}
        onOpenAutoFocus={(e) => { e.preventDefault(); }}
        title="Add Account"
        description={
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-[11px]">Email</Label>
              <Input value={addEmail}
                onChange={e => setAddEmail(e.target.value)}
                placeholder="you@example.com" className="h-8 text-xs text-foreground"
                onKeyDown={e => e.key === "Enter" && handleAdd()} />
              {addEmailError && (
                <p className="text-[10px] text-destructive">{addEmailError}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px]">Password</Label>
              <PasswordInput id="add-pw" value={addPassword} onChange={setAddPassword} />
            </div>
          </div>
        }
        actions={[{ label: "Add", onClick: handleAdd, keepOpen: true, disabled: !addValid }]}
      />

      <ConfirmDialog open={searchAccountOpen}
        onOpenChange={o => {
          setSearchAccountOpen(o);
          if (!o) setSearchAccountQuery("");
        }}
        onCancel={() => setSearchAccountQuery("")}
        onOpenAutoFocus={(e) => { e.preventDefault(); }}
        title="Search Accounts"
        cancelLabel=""
        actions={[]}
        description={
          <div className="space-y-2 py-2">
            <Input
              value={searchAccountQuery}
              onChange={e => setSearchAccountQuery(e.target.value)}
              placeholder="Search by email, username, or ID..."
              className="h-8 text-xs text-foreground"
              autoFocus
              onKeyDown={e => {
                if (e.key === "Escape") { setSearchAccountOpen(false); setSearchAccountQuery(""); }
              }}
            />
            <div className="max-h-60 overflow-y-auto -mx-1 px-1">
              {filteredSearchAccounts.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-3">
                  {searchAccountQuery.trim() ? "No accounts found" : "No accounts"}
                </p>
              ) : (
                filteredSearchAccounts.map(a => {
                  const key = ak(a);
                  const name = a.username?.trim() || a.email;
                  return (
                    <button
                      key={key}
                      onClick={() => {
                        setSearchAccountOpen(false);
                        setSearchAccountQuery("");
                        persistGroups(accountGroups.map(g => ({ ...g, collapsed: false })));
                        setTimeout(() => {
                          const el = document.querySelector(`[data-account-key="${CSS.escape(key)}"]`);
                          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
                        }, 100);
                      }}
                      className="w-full text-left px-2 py-1.5 rounded hover:bg-accent transition-colors flex items-center gap-2"
                    >
                      <Search className="w-3 h-3 text-muted-foreground shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-foreground truncate">{name}</p>
                        {a.username?.trim() && (
                          <p className="text-[10px] text-muted-foreground truncate">{a.email}</p>
                        )}
                      </div>
                      {a.userId != null && a.userId > 0 && (
                        <span className="text-[10px] text-muted-foreground shrink-0">#{a.userId}</span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        }
      />

      <ConfirmDialog open={editOpen}
        onOpenChange={o => { if (!o) { setEditOpen(false); setEditTarget(null); } }}
        onOpenAutoFocus={(e) => { e.preventDefault(); }}
        title="Edit Account"
        description={
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-[11px]">Email</Label>
              <Input value={editEmail}
                onChange={e => setEditEmail(e.target.value)}
                className="h-8 text-xs text-foreground"
                onKeyDown={e => e.key === "Enter" && handleEdit()} />
              {editEmailError && (
                <p className="text-[10px] text-destructive">{editEmailError}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px]">Password</Label>
              <PasswordInput id="edit-pw" value={editPassword}
                onChange={setEditPassword} />
            </div>
          </div>
        }
        actions={[{ label: "Save", onClick: handleEdit, keepOpen: true, disabled: !editValid }]}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={o => { if (!o) setDeleteOpen(false); }}
        title="Delete Account"
        description={
          deleteTarget
            ? `Remove ${deleteTarget.username || deleteTarget.email}? This will also mark it inactive on the server.`
            : ""
        }
        actions={[{
          label: "Delete", onClick: handleDelete,
          className: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        }]}
      />

      <ConfirmDialog open={twoFaOpen}
        onOpenChange={o => { if (!o) { setTwoFaOpen(false); setTwoFaAccount(null); } }}
        title="Two-Factor Authentication"
        description={
          <div className="space-y-3 py-2">
            <p className="text-xs text-muted-foreground">
              Enter the code sent to {twoFaAccount?.email}
            </p>
            <Input value={twoFaCode}
              onChange={e => {
                const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
                setTwoFaCode(digits.length > 3 ? digits.slice(0, 3) + "-" + digits.slice(3) : digits);
                setTwoFaError("");
              }}
              onPaste={e => {
                e.preventDefault();
                const pasted = e.clipboardData.getData("text");
                const digits = pasted.replace(/\D/g, "").slice(0, 6);
                setTwoFaCode(digits.length > 3 ? digits.slice(0, 3) + "-" + digits.slice(3) : digits);
                setTwoFaError("");
              }}
              placeholder="000-000"
              inputMode="numeric" maxLength={7}
              className="h-8 text-xs text-center tracking-[0.3em] font-mono"
              onKeyDown={e => e.key === "Enter" && handleTwoFaSubmit()} />
            {twoFaError && (
              <p className="text-[10px] text-destructive text-center">{twoFaError}</p>
            )}
            <button onClick={handleTwoFaResend} disabled={twoFaResending}
              className="text-[11px] text-primary hover:underline disabled:opacity-40">
              {twoFaResending ? "Resending…" : "Resend code"}
            </button>
          </div>
        }
        actions={[{
          label: "Verify", onClick: handleTwoFaSubmit,
          disabled: twoFaSubmitting || !twoFaCode.trim(),
        }]}
      />
    </div>

    {dragPayload && (() => {
      const vw = document.body.clientWidth;
      const vh = document.body.clientHeight;
      const { w, h } = ghostSizeRef.current;

      return (
        <div
          ref={ghostRef}
          className="fixed pointer-events-none z-[9999] px-2.5 py-1 rounded-md bg-popover border border-border shadow-lg text-xs font-medium text-foreground whitespace-nowrap"
          style={{
            left: Math.max(0, Math.min(dragPos.x + 12, vw - w)),
            top: Math.max(0, Math.min(dragPos.y + 12, vh - h)),
          }}
        >
          {dragPayload.kind === "account" ? (
            <span className="flex items-center gap-1.5">
              <GripVertical className="w-3 h-3 text-muted-foreground" />
              {dragPayload.row.username || dragPayload.row.email}
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <GripVertical className="w-3 h-3 text-muted-foreground" />
              {dragPayload.group.name}
            </span>
          )}
        </div>
      );
    })()}

    </TooltipProvider>
  );
};


const ak = (a: { email: string; userId?: number; accountId?: number }) =>
  accountKey({ email: a.email, userId: a.userId ?? (a.accountId && a.accountId > 0 ? a.accountId : undefined) });

interface DisplayRow {
  email: string;
  username: string;
  accountId: number;
  isLive: boolean;
  isLoggedIn: boolean;
  groupId?: string;
  order?: number;
}

interface AccountRowProps {
  row: DisplayRow;
  account: NormalAccount;
  showEmails: boolean;
  isLaunching: boolean;
  ingameNameMap: Record<string, string>;
  sessionErrors: Record<string, string>;
  sessionFatalErrors: Record<string, boolean>;
  sessionExpiries: Record<string, number | null>;
  loggingIn: Record<string, boolean>;
  touching: Record<string, boolean>;
  starting: Record<string, boolean>;
  injecting: Record<string, boolean>;
  massSelected: Set<string>;
  massEnabled: boolean;
  isDragging: boolean;
  dropIndicator?: "above" | "below";
  rowIndex: number;
  onEdit: (a: NormalAccount) => void;
  onDelete: (a: NormalAccount) => void;
  onLogin: (a: NormalAccount) => void;
  onTouch: (a: NormalAccount) => void;
  onLaunch: (a: NormalAccount) => void;
  onLaunchAndInject: (a: NormalAccount) => void;
  onSelect: (key: string) => void;
  onDragStart: (e: React.MouseEvent, row: DisplayRow) => void;
}

function AccountRow({
  row, account, showEmails, isLaunching, ingameNameMap,
  sessionErrors, sessionFatalErrors, sessionExpiries,
  loggingIn, touching, starting, injecting,
  massSelected, massEnabled, isDragging, dropIndicator, rowIndex, onEdit, onDelete, onLogin, onTouch,
  onLaunch, onLaunchAndInject, onSelect, onDragStart,
}: AccountRowProps) {
  const ek = emailKey(row.email);
  const hasSession = row.isLoggedIn;
  const error = sessionErrors[ek];
  const fatal = sessionFatalErrors[ek];
  const expiry = sessionExpiries[ek];
  const rowKey = ak(row);
  const selected = massSelected.has(rowKey);

  const customName = ingameNameMap[String(row.accountId)];
  const rawName = customName || row.username || row.email;
  const emailIsDisplay = !customName && !row.username;
  const displayName = emailIsDisplay && !showEmails
    ? maskEmail(row.email) : rawName;

  return (
    <>
      {dropIndicator === "above" && (
        <div className="relative h-0 z-10 pointer-events-none">
          <div className="absolute left-2 right-2 -top-[2.5px] h-[3px] rounded-full bg-primary shadow-[0_0_6px_rgba(59,130,246,0.5)]" />
        </div>
      )}
      <div
        data-account-key={rowKey}
        data-drop-account={rowKey}
        className={`setting-row group cursor-pointer hover:bg-accent/40 rounded transition-colors duration-200 !py-0.5 !pr-0.5 ${rowIndex % 2 === 0 ? "bg-secondary/20" : ""} ${isDragging ? "opacity-40" : ""}`}
        onClick={() => onEdit(account)}
      >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          {hasSession && !error && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex cursor-default shrink-0">
                  <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <span>Logged in</span>
                <span className="block text-[10px] text-muted-foreground mt-0.5">
                  {formatExpiry(expiry ?? null)}
                </span>
              </TooltipContent>
            </Tooltip>
          )}
          {hasSession && error && fatal && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex cursor-default shrink-0">
                  <X className="w-3 h-3 text-red-500" />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <span>Session is dead</span>
                <span className="block text-[10px] text-destructive mt-0.5">
                  {error}
                </span>
                <span className="block text-[10px] text-muted-foreground mt-0.5">
                  {formatExpiry(expiry ?? null)}
                </span>
              </TooltipContent>
            </Tooltip>
          )}
          {hasSession && error && !fatal && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex cursor-default shrink-0">
                  <AlertTriangle className="w-3 h-3 text-yellow-500" />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <span>Could not refresh token</span>
                <span className="block text-[10px] text-destructive mt-0.5">
                  {error}
                </span>
                <span className="block text-[10px] text-muted-foreground mt-0.5">
                  {formatExpiry(expiry ?? null)}
                </span>
              </TooltipContent>
            </Tooltip>
          )}
          {row.isLive && (
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
          )}
          <p className="text-xs font-medium text-foreground truncate">
            {displayName}
          </p>
          {row.accountId > 0 && (
            <span className="text-[10px] text-muted-foreground shrink-0">
              #{row.accountId}
            </span>
          )}
          {showEmails && !emailIsDisplay && (
            <span className="text-[10px] text-muted-foreground truncate">
              {row.email}
            </span>
          )}
        </div>
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <div
            onMouseDown={e => onDragStart(e, row)}
            className="shrink-0 cursor-grab active:cursor-grabbing h-6 w-6 flex items-center justify-center text-muted-foreground hover:text-foreground transition-all duration-200 opacity-0 group-hover:opacity-100"
            onClick={e => e.stopPropagation()}
          >
            <GripVertical className="w-3 h-3" />
          </div>
        </TooltipTrigger>
        <TooltipContent>Drag to reorder or move to group</TooltipContent>
      </Tooltip>

      <div className="flex items-center gap-0.5 shrink-0"
        onClick={e => e.stopPropagation()}>
        {massEnabled && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm"
                className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                onClick={() => onSelect(rowKey)}>
                <div className={`w-4 h-4 rounded-sm border transition-all duration-150 flex items-center justify-center ${
                  selected ? "bg-primary border-primary scale-110" : "border-muted-foreground/40 scale-100"}`}>
                  <svg viewBox="0 0 10 10" className="w-1 h-1 fill-none stroke-white" style={{
                    strokeWidth: 1.5, strokeDasharray: 12,
                    strokeDashoffset: selected ? 0 : 12,
                    transition: "stroke-dashoffset 0.18s ease",
                  }}><polyline points="1.5,5 4,7.5 8.5,2.5" /></svg>
                </div>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{selected ? "Deselect" : "Select"}</TooltipContent>
          </Tooltip>
        )}
        {(!hasSession || (hasSession && !!error)) && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button onClick={() => onLogin(account)}
                disabled={!!loggingIn[ak(account)] || !account.password?.trim()}
                variant="ghost" size="sm"
                className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground">
                <LogIn className={`w-3 h-3 ${loggingIn[ak(account)] ? "animate-pulse" : ""}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {account.password?.trim() ? "Login" : "Add password in Edit first"}
            </TooltipContent>
          </Tooltip>
        )}
        {hasSession && !error && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button onClick={() => onTouch(account)}
                disabled={!!touching[ak(account)]}
                variant="ghost" size="sm"
                className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground">
                <RefreshCw className={`w-3 h-3 ${touching[ak(account)] ? "animate-spin" : ""}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh session</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button onClick={() => onDelete(account)}
              variant="ghost" size="sm"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground">
              <Trash2 className="w-3 h-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Delete account</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button onClick={() => onLaunch(account)}
              disabled={isLaunching || !hasSession || !!fatal || !!starting[ak(account)]}
              variant="outline" size="sm" className="h-6 w-6 p-0">
              <Play className="w-3 h-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Launch</TooltipContent>
        </Tooltip>
        {SHOW_LAUNCH_AND_INJECT && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button onClick={() => onLaunchAndInject(account)}
                disabled={isLaunching || !hasSession || !!fatal || !!injecting[ak(account)]}
                size="sm"
                className="h-6 w-6 p-0 bg-primary text-primary-foreground hover:bg-primary/65">
                <Rocket className={`w-3 h-3 ${injecting[ak(account)] ? "animate-pulse" : ""}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Launch &amp; Inject</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
      {dropIndicator === "below" && (
        <div className="relative h-0 z-10 pointer-events-none">
          <div className="absolute left-2 right-2 -top-[2.5px] h-[3px] rounded-full bg-primary shadow-[0_0_6px_rgba(59,130,246,0.5)]" />
        </div>
      )}
    </>
  );
}


function IconLegend() {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground">
              <HelpCircle className="w-3 h-3" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Icon legend</TooltipContent>
      </Tooltip>
      <PopoverContent className="w-68 p-3" side="bottom" align="end">
        <p className="text-xs font-semibold text-foreground mb-2">Icon Legend</p>
        <Section title="Status" items={[
          [<div className="w-2 h-2 rounded-full bg-emerald-500" />, "Online"],
          [<CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />, "Session active"],
          [<AlertTriangle className="w-3.5 h-3.5 text-yellow-500" />, "Session refresh failed"],
          [<X className="w-3.5 h-3.5 text-red-500" />, "Session dead"],
        ]} />
        <Section title="Header" items={[
          [<Plus className="w-3.5 h-3.5 text-muted-foreground" />, "Add account"],
          [<Search className="w-3.5 h-3.5 text-muted-foreground" />, "Search accounts"],
          [<Eye className="w-3.5 h-3.5 text-muted-foreground" />, "Show / hide emails"],
          [<Settings className="w-3.5 h-3.5 text-muted-foreground" />, "Glyph settings"],
          [<HelpCircle className="w-3.5 h-3.5 text-muted-foreground" />, "Icon legend"],
        ]} />
        <Section title="Per Account" items={[
          [<LogIn className="w-3.5 h-3.5 text-muted-foreground" />, "Login"],
          [<RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />, "Refresh session"],
          [<Trash2 className="w-3.5 h-3.5 text-muted-foreground" />, "Delete account"],
          [<Play className="w-3.5 h-3.5 text-muted-foreground" />, "Launch"],
          ...(SHOW_LAUNCH_AND_INJECT ? [[<Rocket className="w-3.5 h-3.5 text-primary" />, "Launch & Inject"] as [JSX.Element, string]] : []),
        ]} />
      </PopoverContent>
    </Popover>
  );
}

function Section({ title, items }: {
  title: string;
  items: [React.ReactNode, string][];
}) {
  return (
    <>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-1">
        {title}
      </p>
      <div className={`space-y-1.5 ${title === "Per Account" ? "" : "mb-3"}`}>
        {items.map(([icon, label], i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-3.5 h-3.5 flex items-center justify-center shrink-0">
              {icon}
            </div>
            <span className="text-xs text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>
    </>
  );
}

export default GlyphSection;
