import { useState, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { Minus, Maximize2, X, Settings, ZoomIn, ZoomOut, Palette } from "lucide-react";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { sessionState, AccessibilitySettings, ThemePreset, DEFAULT_CUSTOM_THEME } from "@/lib/api";
import { applyAccessibility, applyTheme, themePresets, parseCustomTheme, serializeCustomTheme, ZOOM_STEPS, ZOOM_DEFAULT, ZOOM_MIN, ZOOM_MAX } from "@/lib/utils";
import { ColorPicker } from "@/components/ColorPicker";

const formatZoom = (z: number) => `${Math.round(z * 100)}%`;

const WindowControls = () => {
  const win = getCurrentWindow();
  const [confirmClose, setConfirmClose] = useState(false);
  const confirmedRef = useRef(false);
  const [settings, setSettings] = useState<AccessibilitySettings>(() => sessionState.getAccessibility());
  const [siteTheme, setSiteThemeState] = useState<{ preset: ThemePreset; darkMode: boolean; coloredBg: boolean; customTheme: string }>(
    () => sessionState.getSiteTheme() ?? { preset: "default", darkMode: true, coloredBg: false, customTheme: DEFAULT_CUSTOM_THEME }
  );
  const [pendingCustomTheme, setPendingCustomTheme] = useState<string | null>(null);
  const [customPickerTab, setCustomPickerTab] = useState<"primary" | "glow" | "background" | "foreground">("primary");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const siteThemeRef = useRef(siteTheme);
  const pendingRef = useRef<string | null>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    win.onCloseRequested((event) => {
      if (confirmedRef.current) return;
      event.preventDefault();
      setConfirmClose(true);
    }).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  useEffect(() => {
    const sync = (e: Event) => {
      const zoom = (e as CustomEvent<number>).detail;
      setSettings(prev => ({ ...prev, zm: zoom }));
    };
    window.addEventListener("zoom-changed", sync);
    return () => window.removeEventListener("zoom-changed", sync);
  }, []);

  useEffect(() => { siteThemeRef.current = siteTheme; }, [siteTheme]);
  useEffect(() => { pendingRef.current = pendingCustomTheme; }, [pendingCustomTheme]);

  useEffect(() => {
    if (wasOpenRef.current && !settingsOpen) {
      const pending = pendingRef.current;
      if (pending !== null) {
        const current = siteThemeRef.current;
        const next = { ...current, customTheme: pending };
        setSiteThemeState(next);
        applyTheme(next.preset, next.darkMode, next.coloredBg, next.customTheme);
        sessionState.setSiteTheme(next);
        pendingRef.current = null;
        setPendingCustomTheme(null);
      }
    }
    wasOpenRef.current = settingsOpen;
  }, [settingsOpen]);

  const handleConfirmClose = async () => {
    confirmedRef.current = true;
    await invoke("end_game_session").catch(() => {});
    await win.destroy();
  };

  const update = (patch: Partial<AccessibilitySettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    sessionState.setAccessibility(next);
    applyAccessibility(next);
  };

  const updateTheme = (patch: { preset?: ThemePreset; darkMode?: boolean; coloredBg?: boolean; customTheme?: string }) => {
    const next = { ...siteTheme, ...patch };
    setSiteThemeState(next);
    applyTheme(next.preset, next.darkMode, next.coloredBg, next.customTheme);
    sessionState.setSiteTheme(next);
  };

  const zoom = settings.zm ?? 1;
  const canZoomIn  = zoom < ZOOM_MAX - 0.001;
  const canZoomOut = zoom > ZOOM_MIN + 0.001;

  const stepZoom = (dir: 1 | -1) => {
    const next = dir > 0
      ? ZOOM_STEPS.find(z => z > zoom + 0.001) ?? ZOOM_MAX
      : [...ZOOM_STEPS].reverse().find(z => z < zoom - 0.001) ?? ZOOM_MIN;
    update({ zm: next });
    window.dispatchEvent(new CustomEvent("zoom-changed", { detail: next }));
  };

  return (
    <>
      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="Close application?"
        description="This will terminate the application and all child processes (including any running game clients)."
        cancelLabel="Cancel"
        actions={[{
          label: "Close",
          onClick: handleConfirmClose,
          className: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        }]}
      />

      <div className="flex items-center gap-0.5" onMouseDown={e => e.stopPropagation()}>
        <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button
                  className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  <Settings className="w-3 h-3" />
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>
          <PopoverContent className="w-64 p-3 space-y-3" align="end" side="bottom">
            <p className="text-[10px] uppercase tracking-[0.15em] font-medium text-muted-foreground">Display</p>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-foreground">Zoom</p>
                <p className="text-[10px] text-muted-foreground">Ctrl&nbsp;+/−/0 or scroll</p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => stepZoom(-1)}
                  disabled={!canZoomOut}
                  className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-30 transition-colors"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => update({ zm: ZOOM_DEFAULT })}
                  className="min-w-[42px] text-center text-[11px] font-mono text-foreground hover:text-primary transition-colors"
                  title="Reset to 100% (Ctrl+0)"
                >
                  {formatZoom(zoom)}
                </button>
                <button
                  onClick={() => stepZoom(1)}
                  disabled={!canZoomIn}
                  className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-30 transition-colors"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-xs text-foreground">Reduce motion</p>
              <Switch
                checked={settings.rm}
                onCheckedChange={v => update({ rm: v })}
              />
            </div>

            <div className="flex items-center justify-between">
              <p className="text-xs text-foreground">Compact layout</p>
              <Switch
                checked={settings.cl}
                onCheckedChange={v => update({ cl: v })}
              />
            </div>

            <Separator />

                <div className="flex items-center justify-between">
                  <p className="text-[10px] uppercase tracking-[0.15em] font-medium text-muted-foreground">
                    Color Theme{pendingCustomTheme !== null && <span className="text-amber-400 ml-1">*</span>}
                  </p>
                  {pendingCustomTheme !== null && (
                    <button
                      onClick={() => { updateTheme({ customTheme: pendingCustomTheme }); setPendingCustomTheme(null); }}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-primary text-primary-foreground hover:opacity-80 transition-opacity"
                    >
                      Save
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-9 gap-1.5 place-items-center">
                  {(Object.keys(themePresets) as ThemePreset[]).filter(p => p !== "custom").map(p => (
                    <button
                      key={p}
                      title={p}
                      onClick={() => updateTheme({ preset: p })}
                      className={`w-4 h-4 rounded-full transition-all ${
                        siteTheme.preset === p
                          ? "ring-2 ring-offset-1 ring-offset-popover ring-foreground scale-110"
                          : "opacity-70 hover:opacity-100 hover:scale-110"
                      }`}
                      style={{ background: `hsl(${themePresets[p].primary})` }}
                    />
                  ))}
                  <button
                    title="custom"
                    onClick={() => updateTheme({ preset: "custom" })}
                    className={`w-5 h-5 rounded-full flex items-center justify-center transition-all ${
                      siteTheme.preset === "custom"
                        ? "ring-2 ring-offset-1 ring-offset-popover ring-foreground scale-110"
                        : "opacity-70 hover:opacity-100 hover:scale-110"
                    }`}
                    style={{ background: `hsl(${parseCustomTheme(siteTheme.customTheme).primary})` }}
                  >
                    {(() => {
                      const [,, pl] = parseCustomTheme(siteTheme.customTheme).primary.trim().split(/\s+/).map(parseFloat);
                      return <Palette className="w-2.5 h-2.5" style={{ color: pl > 50 ? "rgba(0,0,0,0.8)" : "rgba(255,255,255,0.9)" }} />;
                    })()}
                  </button>
                </div>

                {siteTheme.preset === "custom" && (() => {
                  const ct = parseCustomTheme(pendingCustomTheme ?? siteTheme.customTheme);
                  const tabs = ["primary", "glow", "background", "foreground"] as const;
                  const tabColors = { primary: ct.primary, glow: ct.glow, background: ct.background, foreground: ct.foreground };
                  return (
                    <div className="space-y-2">
                      <div className="flex gap-1">
                        {tabs.map(tab => (
                          <button
                            key={tab}
                            onClick={() => setCustomPickerTab(tab)}
                            className={`flex-1 flex flex-col items-center gap-0.5 py-1 px-0.5 rounded text-[9px] capitalize transition-all ${
                              customPickerTab === tab
                                ? "bg-muted text-foreground"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            <span
                              className="w-3 h-3 rounded-full border border-border/50"
                              style={{ background: `hsl(${tabColors[tab]})` }}
                            />
                            {tab}
                          </button>
                        ))}
                      </div>
                      <ColorPicker
                        value={tabColors[customPickerTab]}
                        onChange={hsl => {
                          const base = parseCustomTheme(pendingCustomTheme ?? siteTheme.customTheme);
                          const updated = serializeCustomTheme({ ...base, [customPickerTab]: hsl });
                          setPendingCustomTheme(updated);
                          applyTheme("custom", siteTheme.darkMode, siteTheme.coloredBg, updated);
                        }}
                      />
                    </div>
                  );
                })()}

                {siteTheme.preset !== "custom" && (
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-foreground">Dark mode</p>
                    <Switch
                      checked={siteTheme.darkMode}
                      onCheckedChange={v => updateTheme({ darkMode: v })}
                    />
                  </div>
                )}

                {siteTheme.preset !== "custom" && (
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-foreground">Colored background</p>
                    <Switch
                      checked={siteTheme.coloredBg}
                      onCheckedChange={v => updateTheme({ coloredBg: v })}
                    />
                  </div>
                )}
          </PopoverContent>
        </Popover>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => win.minimize()}
              className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              tabIndex={-1}
            >
              <Minus className="w-3 h-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Minimize</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => win.toggleMaximize()}
              className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              tabIndex={-1}
            >
              <Maximize2 className="w-3 h-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Maximize</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setConfirmClose(true)}
              className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:bg-destructive hover:text-destructive-foreground transition-colors"
              tabIndex={-1}
            >
              <X className="w-3 h-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Close</TooltipContent>
        </Tooltip>
      </div>
    </>
  );
};

export default WindowControls;
