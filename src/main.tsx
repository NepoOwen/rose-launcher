import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { hydratePd } from "@/lib/pdStorage";

document.addEventListener("contextmenu", (e) => e.preventDefault());

document.addEventListener("keydown", (e) => {
  const fBlocked = ["F1","F2","F4","F6","F7","F8","F9","F10","F11","F12"];
  if (fBlocked.includes(e.key)) {
    e.preventDefault();
    return;
  }

  if ((e.altKey && !e.ctrlKey && (e.key === "ArrowLeft" || e.key === "ArrowRight"))) {
    e.preventDefault();
    return;
  }

  if (e.ctrlKey && e.shiftKey) {
    const shiftBlocked = [
      "I","i","J","j","C","c",
      "G","g",
      "B","b",
      "N","n",
      "T","t",
      "P","p",
      "S","s",
      "W","w",
      "O","o",
      "R","r",
      "D","d",
      "H","h",
      "E","e",
      "A","a",
      "U","u",
      "M","m",
      "K","k",
      "F","f",
      "L","l",
      "Delete",
    ];
    if (shiftBlocked.includes(e.key)) {
      e.preventDefault();
      return;
    }
  }

  if (e.ctrlKey && !e.shiftKey) {
    const blocked = [
      "p","P",
      "s","S",
      "d","D",
      "h","H",
      "l","L",
      "t","T",
      "n","N",
      "w","W",
      "g","G",
      "j","J",
      "o","O",
      "e","E",
      "k","K",
      "u","U",
    ];
    if (blocked.includes(e.key)) {
      e.preventDefault();
    }
  }
}, { capture: true });

window.addEventListener("popstate", (e) => {
  e.stopImmediatePropagation();
  window.history.pushState(null, "", window.location.href);
}, true);

document.addEventListener("mousedown", (e) => {
  if (e.button === 3 || e.button === 4) e.preventDefault();
}, { capture: true });
document.addEventListener("auxclick", (e) => {
  if (e.button === 3 || e.button === 4) e.preventDefault();
}, { capture: true });

async function bootstrap() {
  try {
    await hydratePd();
  } catch {
  }

  createRoot(document.getElementById("root")!).render(<App />);
}

void bootstrap();
