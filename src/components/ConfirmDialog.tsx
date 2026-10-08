import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface ConfirmAction {
  label: React.ReactNode;
  onClick: () => void | Promise<void>;
  className?: string;
  disabled?: boolean;
  keepOpen?: boolean;
}

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  cancelLabel?: string;
  onCancel?: () => void;
  actions: ConfirmAction[];
  onOpenAutoFocus?: (event: Event) => void;
}

const ConfirmDialog = ({
  open,
  onOpenChange,
  title,
  description,
  cancelLabel = "Cancel",
  onCancel,
  actions,
  onOpenAutoFocus,
}: ConfirmDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent hideClose onOpenAutoFocus={onOpenAutoFocus}>
      <DialogHeader className="text-left">
        <DialogTitle>{title}</DialogTitle>
        {description && (
          <DialogDescription asChild>
            <div className="text-sm text-muted-foreground">{description}</div>
          </DialogDescription>
        )}
      </DialogHeader>
      <DialogFooter className="flex-row justify-end space-x-2">
        {cancelLabel && (
          <Button variant="outline" onClick={() => { onCancel?.(); onOpenChange(false); }}>
            {cancelLabel}
          </Button>
        )}
        {actions.map((action, i) => (
          <Button
            key={i}
            className={action.className}
            disabled={action.disabled}
            onClick={async () => {
              if (!action.keepOpen) onOpenChange(false);
              await action.onClick();
            }}
          >
            {action.label}
          </Button>
        ))}
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

export default ConfirmDialog;
