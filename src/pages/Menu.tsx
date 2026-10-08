import { useState, useEffect, useRef, useMemo } from "react";
import { Info, X, RotateCw, Pause, Play } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import InfoModal from "@/components/InfoModal";
import MenuSidebar from "@/components/menu/MenuSidebar";
import GlyphSection from "@/components/menu/GlyphSection";
import AboutSection from "../components/menu/AboutSection";
import logo32 from "@/assets/logo.png";
import { loadGlyphPrefsPd } from "@/lib/pdStorage";
import {
  checkTroveUpdate, applyTroveUpdate, cancelTroveUpdate, pauseTroveUpdate, resumeTroveUpdate, onUpdateProgress,
  type UpdateProgress, type TroveChannel,
} from "@/lib/api";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

const UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000;

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let val = bytes;
  let idx = 0;
  while (val >= 1024 && idx < units.length - 1) { val /= 1024; idx++; }
  return `${val.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
};

type ChannelState =
  | { status: "available"; remoteVersion: string; path: string }
  | { status: "busy"; progress: UpdateProgress | null };

const Menu = () => {
  const [activeSection, setActiveSection] = useState("accounts");
  const [displayedSection, setDisplayedSection] = useState("accounts");
  const [contentVisible, setContentVisible] = useState(true);
  const sectionTransitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ingameNameMap] = useState<Record<string, string>>({});
  const [showWelcomeOverlay, setShowWelcomeOverlay] = useState(true);
  const [fadeWelcomeOverlay, setFadeWelcomeOverlay] = useState(false);
  const welcomeFadedRef = useRef(false);

  const [channelStates, setChannelStates] = useState<Record<TroveChannel, ChannelState | null>>({ live: null, pts: null });
  const [confirmCancel, setConfirmCancel] = useState<Record<TroveChannel, boolean>>({ live: false, pts: false });
  const lastNotifiedVersionRef = useRef<Record<TroveChannel, string | null>>({ live: null, pts: null });
  const busyRef = useRef<Record<TroveChannel, boolean>>({ live: false, pts: false });

  const runApply = async (path: string, channel: TroveChannel) => {
    if (busyRef.current[channel]) return;
    busyRef.current[channel] = true;
    setChannelStates(s => ({ ...s, [channel]: { status: "busy", progress: null } }));
    try {
      await applyTroveUpdate(path, channel);
    } catch {
    }
  };

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onUpdateProgress(p => {
      setChannelStates(s => ({ ...s, [p.channel]: { status: "busy", progress: p } }));
      if (p.phase === "done" || p.phase === "error" || p.phase === "cancelled") {
        busyRef.current[p.channel] = false;
        setChannelStates(s => ({ ...s, [p.channel]: null }));
        setConfirmCancel(s => ({ ...s, [p.channel]: false }));
        if (p.phase === "done") {
          toast({ title: "Trove Updated", description: p.message ?? `${p.channel.toUpperCase()} is up to date.` });
        } else if (p.phase === "error") {
          toast({ title: "Update Failed", description: p.message ?? "Unknown error", variant: "destructive" });
        }
      }
    }).then(fn => { unlisten = fn; });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const checkChannel = async (path: string | undefined, channel: TroveChannel, autoUpdate: boolean) => {
      const trimmed = path?.trim();
      if (!trimmed || busyRef.current[channel]) return;
      try {
        const result = await checkTroveUpdate(trimmed, channel);
        if (cancelled || result.upToDate || !result.hasLocalManifest) return;
        if (lastNotifiedVersionRef.current[channel] === result.remoteVersion) return;
        lastNotifiedVersionRef.current[channel] = result.remoteVersion;
        if (autoUpdate) {
          await runApply(trimmed, channel);
        } else {
          setChannelStates(s => ({ ...s, [channel]: { status: "available", remoteVersion: result.remoteVersion, path: trimmed } }));
        }
      } catch {
      }
    };

    const runCheck = async () => {
      const p = await loadGlyphPrefsPd().catch(() => ({} as Awaited<ReturnType<typeof loadGlyphPrefsPd>>));
      const autoUpdate = p.autoUpdate ?? false;
      await checkChannel(p.trovePath, "live", autoUpdate);
      await checkChannel(p.trovePathPts, "pts", autoUpdate);
    };

    const kickoff = setTimeout(runCheck, 8000);
    const interval = setInterval(runCheck, UPDATE_CHECK_INTERVAL_MS);
    return () => { cancelled = true; clearTimeout(kickoff); clearInterval(interval); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const busyChannels = useMemo(() => {
    const set = new Set<TroveChannel>();
    if (channelStates.live?.status === "busy") set.add("live");
    if (channelStates.pts?.status === "busy") set.add("pts");
    return set;
  }, [channelStates]);

  const triggerWelcomeFadeOut = () => {
    if (welcomeFadedRef.current) return;
    welcomeFadedRef.current = true;
    setFadeWelcomeOverlay(true);
    setTimeout(() => setShowWelcomeOverlay(false), 500);
  };

  useEffect(() => () => {
    if (sectionTransitionTimerRef.current) {
      clearTimeout(sectionTransitionTimerRef.current);
    }
  }, []);

  const transitionToSection = (section: string) => {
    if (section === activeSection || sectionTransitionTimerRef.current) return;

    setContentVisible(false);
    sectionTransitionTimerRef.current = setTimeout(() => {
      setActiveSection(section);
      setDisplayedSection(section);
      setContentVisible(true);
      sectionTransitionTimerRef.current = null;
    }, 180);
  };

  useEffect(() => {
    setTimeout(triggerWelcomeFadeOut, 300);
  }, []);

  const handleClose = () => {
    invoke("end_game_session").catch(() => {});
    getCurrentWindow().destroy().catch(() => {});
  };

  const renderContent = () => {
    switch (displayedSection) {
      case "accounts":
        return (
          <GlyphSection
            isLaunching={false}
            ingameNameMap={ingameNameMap}
            busyChannels={busyChannels}
          />
        );
      case "about":
        return <AboutSection />;
      case "info":
        return (
          <div className="space-y-4">
            <SectionHeader icon={Info} title="About" description="Information about Rose Launcher" />
            <InfoModal />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <>
      <div className="desktop-window w-screen h-screen flex overflow-hidden relative" onMouseDown={(e) => {
        let el = e.target as HTMLElement;
        while (el) {
          const style = window.getComputedStyle(el);
          if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
            if (e.clientX > el.getBoundingClientRect().left + el.clientWidth) return;
          }
          if (style.cursor === 'pointer') return;
          el = el.parentElement as HTMLElement;
          if (!el) break;
        }
        if (!(e.target as HTMLElement).closest('button, input, select, textarea, a, label, [contenteditable], [role]')) {
          getCurrentWindow().startDragging().catch(() => {});
        }
      }}>
        <MenuSidebar
          activeSection={activeSection}
          onSectionChange={transitionToSection}
          onClose={handleClose}
        />
        <div className={`flex-1 overflow-y-auto p-5 flex flex-col transition-opacity duration-200 ${contentVisible ? "opacity-100" : "opacity-0"}`}>
          {renderContent()}
        </div>

        {showWelcomeOverlay && (
          <div
            className={`absolute inset-0 z-[120] flex items-center justify-center bg-background transition-opacity duration-500 ${fadeWelcomeOverlay ? "opacity-0 pointer-events-none" : "opacity-100"}`}
          >
            <div className="flex flex-col items-center gap-4">
              <img src={logo32} alt="Rose Launcher logo" className="w-16 h-16 rounded-md" />
              <p className="text-base font-medium tracking-wide text-foreground">
                Welcome
              </p>
            </div>
          </div>
        )}

        <div className="absolute bottom-3 right-3 z-[150] flex flex-col gap-2 w-64 pointer-events-none">
          {(["live", "pts"] as const).map(channel => {
            const state = channelStates[channel];
            if (!state) return null;
            const label = channel.toUpperCase();

            if (state.status === "available") {
              return (
                <div key={channel} className="pointer-events-auto rounded-lg border border-border bg-card shadow-lg p-3 space-y-2 animate-in slide-in-from-bottom-2 fade-in">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground">{label} Update Available</p>
                      <p className="text-[11px] text-muted-foreground truncate" title={state.remoteVersion}>
                        Version {state.remoteVersion}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-1.5">
                    <Button variant="outline" size="sm" className="h-6 text-[11px] px-2"
                      onClick={() => setChannelStates(s => ({ ...s, [channel]: null }))}>
                      Cancel
                    </Button>
                    <Button size="sm" className="h-6 text-[11px] px-2"
                      onClick={() => runApply(state.path, channel)}>
                      Update
                    </Button>
                  </div>
                </div>
              );
            }

            const progress = state.progress;
            const isPaused = progress?.phase === "paused";
            const percent = progress && progress.overallBytesTotal > 0
              ? Math.min(100, (progress.overallBytesDone / progress.overallBytesTotal) * 100)
              : 0;
            const phaseLabel = (() => {
              if (!progress) return "Preparing…";
              switch (progress.phase) {
                case "checking": return "Checking for changes…";
                case "downloading": return `${progress.currentIndex}/${progress.totalFiles} · ${progress.currentPath}`;
                case "paused": return "Paused";
                case "finalizing": return "Finalizing…";
                default: return "Preparing…";
              }
            })();

            if (confirmCancel[channel]) {
              return (
                <div key={channel} className="pointer-events-auto rounded-lg border border-destructive/50 bg-card shadow-lg p-3 space-y-2 animate-in slide-in-from-bottom-2 fade-in">
                  <p className="text-xs font-semibold text-foreground">Cancel {label} update?</p>
                  <p className="text-[10px] text-muted-foreground">
                    Downloaded files are kept in a staging folder until finished, so cancelling won't corrupt your install - but you'll need to update again later.
                  </p>
                  <div className="flex items-center justify-end gap-1.5">
                    <Button variant="outline" size="sm" className="h-6 text-[11px] px-2"
                      onClick={() => setConfirmCancel(s => ({ ...s, [channel]: false }))}>
                      Keep Going
                    </Button>
                    <Button variant="destructive" size="sm" className="h-6 text-[11px] px-2"
                      onClick={() => { cancelTroveUpdate(channel).catch(() => {}); setConfirmCancel(s => ({ ...s, [channel]: false })); }}>
                      Cancel It
                    </Button>
                  </div>
                </div>
              );
            }

            return (
              <div key={channel} className="pointer-events-auto rounded-lg border border-border bg-card shadow-lg p-3 space-y-2 animate-in slide-in-from-bottom-2 fade-in">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    {isPaused
                      ? <Pause className="w-3 h-3 text-muted-foreground" />
                      : <RotateCw className="w-3 h-3 animate-spin text-primary" />}
                    {isPaused ? `${label} Paused` : `Updating ${label}`}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <button
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      title={isPaused ? "Resume" : "Pause"}
                      onClick={() => (isPaused ? resumeTroveUpdate(channel) : pauseTroveUpdate(channel)).catch(() => {})}
                    >
                      {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      className="text-muted-foreground hover:text-destructive transition-colors"
                      title="Cancel"
                      onClick={() => setConfirmCancel(s => ({ ...s, [channel]: true }))}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground truncate" title={phaseLabel}>{phaseLabel}</p>
                <Progress value={percent} className="h-1.5" />
                <p className="text-[10px] text-muted-foreground text-right">
                  {formatBytes(progress?.overallBytesDone ?? 0)} / {formatBytes(progress?.overallBytesTotal ?? 0)}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
};

const SectionHeader = ({ icon: Icon, title, description }: { icon: any; title: string; description: string }) => (
  <div className="flex items-center gap-3">
    <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center">
      <Icon className="w-4 h-4 text-primary" />
    </div>
    <div>
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <p className="text-[11px] text-muted-foreground">{description}</p>
    </div>
  </div>
);

export default Menu;
