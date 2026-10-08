import { useState } from "react";
import { MonitorPlay, Info, Power } from "lucide-react";
import WindowControls from "@/components/WindowControls";
import ConfirmDialog from "@/components/ConfirmDialog";
import logo32 from "@/assets/logo.png";

interface MenuSidebarProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
  onClose: () => void;
}

const sections = [
  {
    category: "Client",
    items: [
      { id: "accounts", label: "Accounts", icon: MonitorPlay },
    ],
  },
  {
    category: "Settings",
    items: [
      { id: "about", label: "About", icon: Info },
    ],
  },
];

const MenuSidebar = ({ activeSection, onSectionChange, onClose }: MenuSidebarProps) => {
  const [showUnloadDialog, setShowUnloadDialog] = useState(false);

  return (
    <>
    <div className="w-48 border-r border-border flex flex-col h-full bg-sidebar">
      <div className="h-11 pl-1.5 pr-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src={logo32} alt="Rose Launcher logo" className="w-8 h-8 rounded-sm" />
        </div>
        <WindowControls />
      </div>

      <div className="flex-1 py-3 px-2 space-y-4 overflow-y-auto">
        {sections.map((section) => (
          <div key={section.category}>
            <p className="section-label px-2">{section.category}</p>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => onSectionChange(item.id)}
                    className={`nav-item w-full ${isActive ? "active" : ""}`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span className="text-xs">{item.label}</span>
                  </button>
                );
              })}
              {section.category === "Settings" && (
                <button
                  onClick={() => setShowUnloadDialog(true)}
                  className="nav-item w-full text-destructive/60 hover:text-destructive hover:bg-destructive/10"
                >
                  <Power className="w-3.5 h-3.5" />
                  <span className="text-xs">Close</span>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>

      <ConfirmDialog
        open={showUnloadDialog}
        onOpenChange={setShowUnloadDialog}
        title="Close application?"
        description="This will close Rose Launcher and end any active game sessions."
        actions={[{
          label: "Close",
          onClick: onClose,
          className: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        }]}
      />
    </>
  );
};

export default MenuSidebar;
