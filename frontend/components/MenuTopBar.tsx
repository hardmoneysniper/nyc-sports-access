"use client";

export default function MenuTopBar({ open, left, onToggle, compact = false }: {
  open: boolean;
  left: number;
  onToggle: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={open ? "Hide Menu" : "Show Menu"}
      title={open ? "Hide Menu" : "Show Menu"}
      style={{ position: "absolute", top: 0, left, zIndex: 1200, width: compact ? 34 : 110, height: 34, boxSizing: "border-box", overflow: "hidden", background: "#000", color: "#fff", border: "1px solid #333", borderRadius: 2, padding: "0 12px", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", cursor: "pointer", transition: "left 300ms ease, width 220ms ease" }}
    >
      <MenuArrow direction={open ? "left" : "right"} />
      <span aria-hidden style={{ marginLeft: 6, whiteSpace: "nowrap", opacity: compact ? 0 : 1, transition: "opacity 150ms ease" }}>
        {open ? "Hide Menu" : "Show Menu"}
      </span>
    </button>
  );
}

function MenuArrow({ direction }: { direction: "left" | "right" }) {
  return (
    <svg width={8} height={12} viewBox="0 0 8 12" fill="none" aria-hidden style={{ display: "block", flexShrink: 0 }}>
      <path d={direction === "left" ? "M6.5 1L1.5 6L6.5 11" : "M1.5 1L6.5 6L1.5 11"} stroke="#fff" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
