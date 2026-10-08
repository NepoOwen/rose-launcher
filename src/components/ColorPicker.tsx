import { useRef, useState, useEffect, useCallback } from "react";

function hslStrToHsv(hsl: string): [number, number, number] {
  const parts = hsl.trim().split(/\s+/);
  const h = parseFloat(parts[0]) || 0;
  const s = (parseFloat(parts[1]) || 0) / 100;
  const l = (parseFloat(parts[2]) || 0) / 100;
  const v = l + s * Math.min(l, 1 - l);
  const sv = v === 0 ? 0 : 2 * (1 - l / v);
  return [h, sv * 100, v * 100];
}

function hsvToHslStr(h: number, s: number, v: number): string {
  const sv = s / 100, vv = v / 100;
  const l = vv * (1 - sv / 2);
  const sl = (l === 0 || l === 1) ? 0 : (vv - l) / Math.min(l, 1 - l);
  return `${Math.round(h)} ${Math.round(sl * 100)}% ${Math.round(l * 100)}%`;
}

export function hslToHex(hsl: string): string {
  const parts = hsl.trim().split(/\s+/);
  const h = parseFloat(parts[0]) || 0;
  const s = (parseFloat(parts[1]) || 0) / 100;
  const l = (parseFloat(parts[2]) || 0) / 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function hexToHsl(hex: string): string | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return null;
  const r = parseInt(m[1], 16) / 255;
  const g = parseInt(m[2], 16) / 255;
  const b = parseInt(m[3], 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) * 60; break;
      case g: h = ((b - r) / d + 2) * 60; break;
      case b: h = ((r - g) / d + 4) * 60; break;
    }
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

interface ColorPickerProps {
  value: string;
  onChange: (hsl: string) => void;
}

export function ColorPicker({ value, onChange }: ColorPickerProps) {
  const [hsv, setHsv] = useState<[number, number, number]>(() => hslStrToHsv(value));
  const [hexInput, setHexInput] = useState(() => hslToHex(value));
  const squareRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setHsv(hslStrToHsv(value));
    setHexInput(hslToHex(value));
  }, [value]);

  const [h, s, v] = hsv;
  const currentHsl = hsvToHslStr(h, s, v);
  const currentHex = hslToHex(currentHsl);
  const lightness = parseFloat(currentHsl.split(/\s+/)[2]);

  const handleSquare = useCallback((clientX: number, clientY: number) => {
    const el = squareRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const newS = nx * 100;
    const newV = (1 - ny) * 100;
    const newHsv: [number, number, number] = [h, newS, newV];
    setHsv(newHsv);
    const hsl = hsvToHslStr(...newHsv);
    setHexInput(hslToHex(hsl));
    onChange(hsl);
  }, [h, onChange]);

  const onSquarePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    handleSquare(e.clientX, e.clientY);
  };
  const onSquarePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    handleSquare(e.clientX, e.clientY);
  };

  const handleHue = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const newH = Math.round(nx * 360);
    const newHsv: [number, number, number] = [newH, s, v];
    setHsv(newHsv);
    const hsl = hsvToHslStr(...newHsv);
    setHexInput(hslToHex(hsl));
    onChange(hsl);
  }, [s, v, onChange]);

  const onTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    handleHue(e.clientX);
  };
  const onTrackPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    handleHue(e.clientX);
  };

  return (
    <div className="space-y-2">
      <div
        ref={squareRef}
        className="relative w-full rounded cursor-crosshair select-none touch-none"
        style={{ height: 160, background: `linear-gradient(to right, #fff, hsl(${h}, 100%, 50%))` }}
        onPointerDown={onSquarePointerDown}
        onPointerMove={onSquarePointerMove}
      >
        <div
          className="absolute inset-0 rounded pointer-events-none"
          style={{ background: "linear-gradient(to bottom, transparent, #000)" }}
        />
        <div
          className="absolute w-3 h-3 rounded-full border-2 border-white shadow pointer-events-none"
          style={{
            left: `${s}%`,
            top: `${100 - v}%`,
            transform: "translate(-50%, -50%)",
            background: currentHex,
          }}
        />
      </div>

      <div
        ref={trackRef}
        className="relative h-3 rounded cursor-pointer select-none touch-none"
        style={{
          background:
            "linear-gradient(to right, hsl(0,100%,50%), hsl(60,100%,50%), hsl(120,100%,50%), hsl(180,100%,50%), hsl(240,100%,50%), hsl(300,100%,50%), hsl(360,100%,50%))",
        }}
        onPointerDown={onTrackPointerDown}
        onPointerMove={onTrackPointerMove}
      >
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-4 rounded-sm border-2 border-white shadow pointer-events-none"
          style={{ left: `${(h / 360) * 100}%`, background: `hsl(${h}, 100%, 50%)` }}
        />
      </div>

      <input
        type="text"
        value={hexInput}
        onChange={e => {
          const val = e.target.value;
          setHexInput(val);
          const hsl = hexToHsl(val);
          if (hsl) {
            setHsv(hslStrToHsv(hsl));
            onChange(hsl);
          }
        }}
        maxLength={7}
        className="w-full px-2 py-1 text-xs font-mono rounded text-center outline-none border border-white/10"
        style={{
          background: currentHex,
          color: lightness > 50 ? "rgba(0,0,0,0.85)" : "rgba(255,255,255,0.9)",
        }}
      />
    </div>
  );
}
