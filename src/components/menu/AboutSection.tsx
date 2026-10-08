import { Info, Heart, ExternalLink } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { APP_VERSION } from "@/lib/api";

const ROSE_LAUNCHER_URL = "https://github.com/NepoOwen/rose-launcher";
const CREATOR_GITHUB_URL = "https://github.com/NepoOwen";

const AboutSection = () => {
  const openRoseLauncher = () => {
    invoke("open_url", { url: ROSE_LAUNCHER_URL }).catch(() => {});
  };
  const openCreatorGithub = () => {
    invoke("open_url", { url: CREATOR_GITHUB_URL }).catch(() => {});
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center">
          <Info className="w-4 h-4 text-primary" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-foreground">About Rose Launcher</h2>
          <p className="text-[11px] text-muted-foreground">Build information</p>
        </div>
      </div>

      <div>
        <p className="section-label">Launcher</p>
        <div className="space-y-0.5">
          <div className="setting-row">
            <div>
              <p className="text-xs font-medium text-foreground">Version</p>
              <p className="text-[11px] text-muted-foreground">Current Rose Launcher build</p>
            </div>
            <span className="text-xs font-mono text-muted-foreground">v{APP_VERSION}</span>
          </div>
        </div>
      </div>

      <div>
        <p className="section-label">Credits</p>
        <div className="rounded-lg bg-secondary/50 p-3 space-y-3">
          <div className="flex items-start gap-2">
            <Heart className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Created by{" "}
              <span className="text-foreground font-medium">Nepo</span>. Thanks also to everyone
              who tested, reported bugs, and pushed features along the way.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full h-8 text-xs"
            onClick={openCreatorGithub}
          >
            <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
            NepoOwen on GitHub
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full h-8 text-xs"
            onClick={openRoseLauncher}
          >
            <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
            View Rose Launcher on GitHub
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AboutSection;
