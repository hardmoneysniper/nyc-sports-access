"use client";

import { useEffect, type ReactNode } from "react";
import { useInView } from "./useInView";

// Keeps the visual pinned in one place on screen while scenes cross-fade
// as the user scrolls, instead of each scene being its own stacked
// section the page scrolls past. Deliberately NOT built on a hand-rolled
// continuous scroll-fraction calculation (window.scrollY vs. a measured
// track offsetTop/offsetHeight) -- an earlier version of scroll animation
// on this project used exactly that and broke ("only the first section
// ever showed"). This instead uses only IntersectionObserver (the
// primitive already proven everywhere else on this page) on a thin
// "trigger" zone per scene, placed at a fixed CSS percentage within a
// `sceneCount * 100vh` tall track -- no JS measurement of scroll position
// at all. Per project owner instruction, 2026-10-05.
function SceneTrigger({
  index,
  count,
  onActivate,
}: {
  index: number;
  count: number;
  onActivate: (index: number) => void;
}) {
  const { ref, inView } = useInView<HTMLDivElement>(0.5);
  useEffect(() => {
    if (inView) onActivate(index);
  }, [inView, index, onActivate]);
  return (
    <div
      ref={ref}
      aria-hidden
      style={{ position: "absolute", top: `${(index / count) * 100}%`, height: `${(1 / count) * 100}%`, width: "100%" }}
    />
  );
}

export default function PinnedScrollSequence({
  scenes,
  activeIndex,
  onActivate,
  stickyHeight = 560,
}: {
  scenes: ReactNode[];
  activeIndex: number;
  onActivate: (index: number) => void;
  stickyHeight?: number;
}) {
  const n = scenes.length;
  return (
    <div style={{ position: "relative", height: `${n * 100}vh` }}>
      <div style={{ position: "sticky", top: "15vh", height: stickyHeight, display: "flex", alignItems: "center" }}>
        <div style={{ position: "relative", width: "100%" }}>
          {scenes.map((scene, i) => (
            <div
              key={i}
              style={{
                position: i === 0 ? "relative" : "absolute",
                inset: 0,
                opacity: i === activeIndex ? 1 : 0,
                transition: "opacity 500ms ease",
                pointerEvents: i === activeIndex ? "auto" : "none",
              }}
            >
              {scene}
            </div>
          ))}
        </div>
      </div>
      {scenes.map((_, i) => (
        <SceneTrigger key={i} index={i} count={n} onActivate={onActivate} />
      ))}
    </div>
  );
}
