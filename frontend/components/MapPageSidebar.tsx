"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// Left navigation rail for the map page only, per 1B.png (design reference
// -- map/control colors in that mock are not part of this scope, only the
// rail itself). "Show Menu" is a dummy button for now (no menu wired up
// yet -- that's second phase, along with a real "About" destination).
// Per project owner instruction, 2026-09-28.
const SIDEBAR_WIDTH = 96;
const ANIMATION_MS = 320;

type NavId = "data" | "about" | "methodology";

function SidebarNavItem({
  label,
  active,
  onClick,
  href,
  flexBasis,
}: {
  label: string;
  active: boolean;
  onClick?: () => void;
  href?: string;
  flexBasis?: string;
}) {
  // Starts off-screen right (translateX 100%) and slides to 0% once
  // mounted/active -- the same transform is reused for exit, so becoming
  // inactive slides back out to the right ("retreats"), and whichever item
  // becomes active slides in from the right ("emerges") at the same time,
  // per project owner instruction, 2026-09-28.
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!active) {
      setEntered(false);
      return;
    }
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, [active]);

  const isFilled = active && entered;

  const inner = (
    <div
      onClick={onClick}
      style={{
        position: "relative",
        overflow: "hidden",
        flex: flexBasis ? `0 0 ${flexBasis}` : "0 0 auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: flexBasis ? 0 : "32px 0",
        cursor: "pointer",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background: "#fff",
          transform: `translateX(${isFilled ? "0%" : "100%"})`,
          transition: `transform ${ANIMATION_MS}ms ease`,
        }}
      />
      <span
        style={{
          position: "relative",
          zIndex: 1,
          writingMode: "vertical-rl",
          fontSize: 15,
          fontWeight: 600,
          letterSpacing: 1,
          color: isFilled ? "#000" : "#fff",
          transition: `color ${ANIMATION_MS}ms ease`,
          userSelect: "none",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
    </div>
  );

  if (href) {
    return (
      <Link href={href} style={{ textDecoration: "none", display: "flex" }}>
        {inner}
      </Link>
    );
  }
  return inner;
}

export default function MapPageSidebar() {
  // "data" (this map page) is the only real destination today -- "about"
  // is a dummy in-place toggle (no About page yet) purely so the
  // emerge/retreat transition is exercised; "methodology" is a real link.
  const [activeTab, setActiveTab] = useState<NavId>("data");

  return (
    <>
      <nav
        style={{
          flex: `0 0 ${SIDEBAR_WIDTH}px`,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#000",
        }}
      >
        <SidebarNavItem
          label="Data"
          active={activeTab === "data"}
          flexBasis="20%"
          onClick={() => setActiveTab("data")}
        />
        <div style={{ flex: 1 }} />
        <SidebarNavItem label="About" active={activeTab === "about"} onClick={() => setActiveTab("about")} />
        <div style={{ flex: "0 0 64px" }} />
        <SidebarNavItem label="Methodology" active={activeTab === "methodology"} href="/methodology" />
        <div style={{ flex: "0 0 48px" }} />
      </nav>
      <button
        type="button"
        style={{
          position: "absolute",
          top: 10,
          left: SIDEBAR_WIDTH + 10,
          zIndex: 1200,
          background: "#000",
          color: "#fff",
          border: "1px solid #fff",
          borderRadius: 2,
          padding: "8px 12px",
          fontSize: 13,
          fontWeight: 600,
          display: "flex",
          alignItems: "center",
          gap: 6,
          cursor: "pointer",
        }}
      >
        Show Menu
        <span aria-hidden>{"›"}</span>
      </button>
    </>
  );
}
