import { useEffect, useCallback, useState } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Menu from "./pages/Menu";
import NotFound from "./pages/NotFound";
import SearchModal from "./components/SearchModal";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { sessionState, glyphAuth, parseGlyphError, parseGlyphErrorString } from "@/lib/api";
import { applyAccessibility, ZOOM_STEPS, ZOOM_DEFAULT, ZOOM_MIN, ZOOM_MAX } from "@/lib/utils";
import { hydratePd, getAllGlyphSessionsPd, saveGlyphSessionPd, setGlyphSessionErrorPd } from "@/lib/pdStorage";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

const queryClient = new QueryClient();

const App = () => {
  const [searchOpen, setSearchOpen] = useState(false);
  const [refreshConfirm, setRefreshConfirm] = useState(false);
  const [ticketFailures, setTicketFailures] = useState<Array<{ email: string; reason: string }>>([]);
  const [ticketFailuresOpen, setTicketFailuresOpen] = useState(false);

  const adjustZoom = useCallback((delta: 1 | -1 | 0) => {
    const current = sessionState.getAccessibility().zm ?? 1;
    let next: number;
    if (delta === 0) {
      next = ZOOM_DEFAULT;
    } else if (delta > 0) {
      next = ZOOM_STEPS.find(z => z > current + 0.001) ?? ZOOM_MAX;
    } else {
      next = [...ZOOM_STEPS].reverse().find(z => z < current - 0.001) ?? ZOOM_MIN;
    }
    const settings = { ...sessionState.getAccessibility(), zm: next };
    sessionState.setAccessibility(settings);
    applyAccessibility(settings);
    window.dispatchEvent(new CustomEvent("zoom-changed", { detail: next }));
  }, []);

  useEffect(() => {
    let touchIntervalId: ReturnType<typeof setInterval> | null = null;

    function getTicketExpirationMs(details_b64: string): number | null {
      try {
        const raw = atob(details_b64);
        const match = raw.match(/expiration="([^"]+)"/);
        if (!match) return null;
        const ms = Date.parse(match[1]);
        return isNaN(ms) ? null : ms;
      } catch {
        return null;
      }
    }

    async function touchAllSessions(): Promise<void> {
      const sessions = await getAllGlyphSessionsPd();
      const emails = Object.keys(sessions);
      if (emails.length === 0) return;
      const TOUCH_THRESHOLD_MS = 47 * 60 * 60 * 1000;
      const now = Date.now();
      const failures: Array<{ email: string; reason: string }> = [];
      for (const email of emails) {
        const session = sessions[email];
        if (session.refresh_error) {
          continue;
        }
        const expiresAt = getTicketExpirationMs(session.details_b64);
        if (expiresAt != null && expiresAt - now > TOUCH_THRESHOLD_MS) {
          continue;
        }
        try {
          const result = await glyphAuth.touchAccount(session.details_b64);
          const authError = parseGlyphError(result);
          if (authError) {
            failures.push({ email, reason: authError });
            await setGlyphSessionErrorPd(email, authError);
            continue;
          }
          await saveGlyphSessionPd(email, { details_b64: result.details_b64, saved_at_unix: result.saved_at_unix });
        } catch (e) {
          const reason = parseGlyphErrorString(String(e));
          failures.push({ email, reason });
          await setGlyphSessionErrorPd(email, reason).catch(() => {});
        }
      }
      if (failures.length > 0) {
        setTicketFailures(failures);
        setTicketFailuresOpen(true);
      }
      window.dispatchEvent(new CustomEvent("glyph-sessions-changed"));
    }

    hydratePd().then(() => {
      applyAccessibility(sessionState.getAccessibility());
      touchAllSessions().catch(() => {});
      touchIntervalId = setInterval(() => touchAllSessions().catch(() => {}), 40 * 60 * 60 * 1000);
    });

    const isMain = getCurrentWindow().label === "main";
    let origLog = console.log.bind(console);
    let origWarn = console.warn.bind(console);
    let origError = console.error.bind(console);

    if (isMain) {
      const push = (level: string, args: unknown[]) => {
        const message = args.map(a => (typeof a === "string" ? a : JSON.stringify(a, null, 2))).join(" ");
        const now = new Date();
        const ts = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}.${now.getMilliseconds().toString().padStart(3, "0")}`;
        emit("rose:log", { level, message, timestamp: ts }).catch(() => {});
      };
      console.log = (...args: unknown[]) => { origLog(...args); push("log", args); };
      console.warn = (...args: unknown[]) => { origWarn(...args); push("warn", args); };
      console.error = (...args: unknown[]) => { origError(...args); push("error", args); };
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F3" || (e.ctrlKey && (e.key === "f" || e.key === "F"))) {
        e.preventDefault();
        setSearchOpen(prev => !prev);
        return;
      }

      if (e.key === "F5" || (e.ctrlKey && (e.key === "r" || e.key === "R"))) {
        e.preventDefault();
        setRefreshConfirm(true);
        return;
      }

      if (!e.ctrlKey) return;
      if (e.key === "+" || e.key === "=" || e.key === "NumpadAdd") {
        e.preventDefault();
        adjustZoom(1);
      } else if (e.key === "-" || e.key === "_" || e.key === "NumpadSubtract") {
        e.preventDefault();
        adjustZoom(-1);
      } else if (e.key === "0") {
        e.preventDefault();
        adjustZoom(0);
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      adjustZoom(e.deltaY < 0 ? 1 : -1);
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      if (touchIntervalId !== null) clearInterval(touchIntervalId);
      if (isMain) {
        console.log = origLog;
        console.warn = origWarn;
        console.error = origError;
      }
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", onWheel);
    };
  }, [adjustZoom]);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={400} disableHoverableContent>
        <Toaster />
        <Sonner />
        <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
        <ConfirmDialog
          open={refreshConfirm}
          onOpenChange={setRefreshConfirm}
          title="Refresh app?"
          description="This will reload the application. Any unsaved data will be lost."
          actions={[{ label: "Refresh", onClick: () => window.location.reload() }]}
        />
        <Dialog open={ticketFailuresOpen} onOpenChange={setTicketFailuresOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Ticket Refresh Failed</DialogTitle>
              <DialogDescription>
                Accounts listed below could not refresh automatically and may require re-authentication soon.
              </DialogDescription>
            </DialogHeader>
            <p className="text-xs text-muted-foreground mb-3">
              The following accounts could not be refreshed automatically. Their old sessions are still saved - you may still be able to use them until they expire.
            </p>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {ticketFailures.map(({ email, reason }) => (
                <div key={email} className="flex flex-col gap-0.5 rounded-md bg-secondary px-3 py-2">
                  <span className="text-xs font-medium text-foreground truncate">{email}</span>
                  <span className="text-xs text-destructive">{reason}</span>
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Menu />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
