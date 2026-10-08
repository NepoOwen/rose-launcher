import { Settings, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { sessionState, AccessibilitySettings } from "@/lib/api";
import { applyAccessibility, ZOOM_STEPS, ZOOM_DEFAULT, ZOOM_MIN, ZOOM_MAX } from "@/lib/utils";
import { useState, useEffect } from "react";

const formatZoom = (z: number) => `${Math.round(z * 100)}%`;

const GlobalSection = () => {
  const [settings, setSettings] = useState<AccessibilitySettings>(() =>
    sessionState.getAccessibility()
  );

  useEffect(() => {
    const sync = (e: Event) => {
      const zm = (e as CustomEvent<number>).detail;
      setSettings(prev => ({ ...prev, zm }));
    };
    window.addEventListener("zoom-changed", sync);
    return () => window.removeEventListener("zoom-changed", sync);
  }, []);

  const update = (patch: Partial<AccessibilitySettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    sessionState.setAccessibility(next);
    applyAccessibility(next);
  };

  const zoom = settings.zm ?? 1;
  const canZoomIn  = zoom < ZOOM_MAX - 0.001;
  const canZoomOut = zoom > ZOOM_MIN + 0.001;

  const stepZoom = (dir: 1 | -1) => {
    const next = dir > 0
      ? ZOOM_STEPS.find(z => z > zoom + 0.001) ?? ZOOM_MAX
      : [...ZOOM_STEPS].reverse().find(z => z < zoom - 0.001) ?? ZOOM_MIN;
    update({ zm: next });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center">
          <Settings className="w-4 h-4 text-primary" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-foreground">Global Settings</h2>
          <p className="text-[11px] text-muted-foreground">Accessibility & display preferences</p>
        </div>
      </div>

      <div>
        <p className="section-label">Display</p>
        <div className="space-y-0.5">
          <div className="setting-row">
            <div>
              <p className="text-xs font-medium text-foreground">Reduce motion</p>
              <p className="text-[11px] text-muted-foreground">Disable UI animations and transitions</p>
            </div>
            <Switch
              checked={settings.rm}
              onCheckedChange={v => update({ rm: v })}
            />
          </div>
          <div className="setting-row">
            <div>
              <p className="text-xs font-medium text-foreground">Compact layout</p>
              <p className="text-[11px] text-muted-foreground">Reduce padding and spacing throughout the UI</p>
            </div>
            <Switch
              checked={settings.cl}
              onCheckedChange={v => update({ cl: v })}
            />
          </div>

          <div className="setting-row">
            <div>
              <p className="text-xs font-medium text-foreground">Zoom</p>
              <p className="text-[11px] text-muted-foreground">Ctrl&nbsp;+&nbsp;/&nbsp;−&nbsp;/&nbsp;0 or Ctrl&nbsp;+&nbsp;scroll</p>
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
                className="min-w-[44px] text-center text-[11px] font-mono text-foreground hover:text-primary transition-colors"
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
              {zoom !== ZOOM_DEFAULT && (
                <button
                  onClick={() => update({ zm: ZOOM_DEFAULT })}
                  className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                  title="Reset zoom"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GlobalSection;
