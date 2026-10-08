import { Info } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface InfoModalProps {
  trigger?: React.ReactNode;
}

const InfoModal = ({ trigger }: InfoModalProps) => {
  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="sm" className="h-7 text-[11px] text-muted-foreground hover:text-foreground">
            <Info className="w-3.5 h-3.5 mr-1" />
            View
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="bg-card border-border max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm text-foreground">
            <Info className="w-4 h-4 text-primary" />
            About Rose Launcher
          </DialogTitle>
          <DialogDescription className="text-xs">
            Product information and quick statistics for Rose Launcher.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-3 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center">
              <div className="w-4 h-4 rounded-md bg-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">ROSE LAUNCHER</h2>
              <p className="text-[11px] text-muted-foreground">v1.0.0</p>
            </div>
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed">
            Rose Launcher is a game mod launcher and manager. Load configurations,
            manage instances, and control mods from one place.
          </p>

          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-secondary p-2.5 text-center">
              <p className="text-sm font-semibold text-foreground">10+</p>
              <p className="text-[10px] text-muted-foreground">Games</p>
            </div>
            <div className="rounded-lg bg-secondary p-2.5 text-center">
              <p className="text-sm font-semibold text-foreground">50k+</p>
              <p className="text-[10px] text-muted-foreground">Users</p>
            </div>
            <div className="rounded-lg bg-secondary p-2.5 text-center">
              <p className="text-sm font-semibold text-foreground">99%</p>
              <p className="text-[10px] text-muted-foreground">Uptime</p>
            </div>
          </div>

          <p className="text-[10px] text-muted-foreground text-center">© 2026 Rose Launcher</p>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default InfoModal;
