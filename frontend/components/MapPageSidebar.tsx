"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// Left navigation rail, shared by every page (map + methodology) -- per
// 1B.png (design reference -- map/control colors in that mock are not
// part of this scope, only the rail itself). Per project owner
// instruction, 2026-09-28.
// The "Show Menu"/"Hide Menu" toggle used to live here, attached to the
// rail's right edge -- moved to attach to the methodology catalog panel's
// own right edge instead (MethodologyMenuPanel), since the button is
// conceptually part of the popup menu, not the rail. Per project owner
// instruction, 2026-10-05.
// Sized off the design reference (1B.png). Per project owner instruction,
// 2026-09-28.
const MENU_FONT_SIZE = 13 * 1.5;
// ~28% thinner than the previous 64px rail. Per project owner instruction,
// 2026-09-28.
export const SIDEBAR_WIDTH = 46;
const ANIMATION_MS = 320;

type NavId = "data" | "about" | "methodology";

function SidebarNavItem({
  label,
  active,
  onClick,
  href,
  padding,
}: {
  label: string;
  active: boolean;
  onClick?: () => void;
  href?: string;
  padding: string;
}) {
  // Starts off-screen right (translateX 100%) and slides to 0% once
  // mounted/active -- the same transform is reused for exit, so becoming
  // inactive slides back out to the right ("retreats"), and whichever item
  // becomes active slides in from the right ("emerges") at the same time.
  // Hover reuses the exact same transform/transition, independent of
  // active state, so hovering an inactive item previews the same
  // right-to-left slide and reverses on hover-off. Per project owner
  // instruction, 2026-09-28.
  const [entered, setEntered] = useState(false);
  const [hovered, setHovered] = useState(false);

  // Reset happens during render, via React's documented "adjusting state
  // when a prop changes" pattern (state, not a ref -- refs can't be read
  // during render under this project's lint rules), not inside the effect
  // below -- calling setState synchronously in an effect body is flagged
  // by react-hooks/set-state-in-effect.
  const [prevActive, setPrevActive] = useState(active);
  if (active !== prevActive) {
    setPrevActive(active);
    if (!active) setEntered(false);
  }

  useEffect(() => {
    if (!active) return;
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, [active]);

  const isFilled = (active && entered) || hovered;
  const router = useRouter();

  // Navigation goes through router.push (not a <Link> wrapper) so every
  // nav item -- Data, About, Methodology -- renders the exact same DOM
  // structure with no extra wrapping element around any one of them. A
  // <Link>-wrapped item previously sat slightly off from the others even
  // with display:"contents" applied; identical markup is what actually
  // guarantees Data and Methodology align on the same vertical axis. Per
  // project owner instruction, 2026-09-28.
  const handleClick = () => {
    onClick?.();
    if (href) router.push(href);
  };

  return (
    <div
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        overflow: "hidden",
        width: "100%",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding,
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
      {/* writing-mode (not a CSS transform) so the box's own layout size --
          used below to make each box hug its label -- is computed from the
          rotated footprint, not the unrotated one; the extra 180deg flip
          is layered on top per project owner instruction, 2026-09-28. */}
      <span
        style={{
          position: "relative",
          zIndex: 1,
          writingMode: "vertical-rl",
          transform: "rotate(180deg)",
          fontSize: MENU_FONT_SIZE,
          fontWeight: 400,
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
}

export default function MapPageSidebar() {
  const pathname = usePathname();
  const routeTab: NavId = pathname?.startsWith("/methodology") ? "methodology" : "data";
  const [aboutActive, setAboutActive] = useState(false);
  const activeTab: NavId = aboutActive ? "about" : routeTab;

  return (
    <nav
      style={{
        flex: `0 0 ${SIDEBAR_WIDTH}px`,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        background: "#000",
        // Static divider -- lives on the <nav> container itself, not
        // inside any animated item, so it never moves regardless of
        // active/hover state. Per project owner instruction, 2026-09-28.
        borderRight: "3px solid #fff",
      }}
    >
      <SidebarNavItem
        label="Data"
        active={activeTab === "data"}
        padding="54px 8px"
        href="/explore"
        onClick={() => setAboutActive(false)}
      />
      <div style={{ flex: 1 }} />
      <SidebarNavItem
        label="About"
        active={activeTab === "about"}
        padding="30px 8px"
        href="/"
        onClick={() => setAboutActive(true)}
      />
      <div style={{ flex: "0 0 56px" }} />
      <SidebarNavItem
        label="Methodology"
        active={activeTab === "methodology"}
        padding="30px 8px"
        href="/methodology"
        onClick={() => setAboutActive(false)}
      />
      <div style={{ flex: "0 0 48px" }} />
    </nav>
  );
}
