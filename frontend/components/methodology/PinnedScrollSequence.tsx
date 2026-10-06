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
  topPercent,
  heightPercent,
  onActivate,
}: {
  index: number;
  topPercent: number;
  heightPercent: number;
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
      style={{ position: "absolute", top: `${topPercent}%`, height: `${heightPercent}%`, width: "100%" }}
    />
  );
}

// position:sticky's "top" is measured from the nearest scrolling ancestor's
// PADDING edge, not the true viewport edge -- the methodology page's
// content pane has its own top padding (64px), so a plain `top:0` box
// actually sticks 64px below the real viewport top, and a 100vh-tall box
// starting there gets its bottom 64px clipped by that same ancestor's own
// overflow:auto bottom edge. The flex-centered content still centers on
// the box's own (uncompensated) height, so it reads as sitting ~64px
// lower than the screen's true center. `topOffset` is the ancestor's own
// top padding, passed in to cancel that out (via a negative `top`).
// Reported live, 2026-10-06 ("both of them [the burden score and travel
// time diagrams]... a little bit lower than the center").
export default function PinnedScrollSequence({
  scenes,
  activeIndex,
  onActivate,
  topOffset = 0,
}: {
  scenes: ReactNode[];
  activeIndex: number;
  onActivate: (index: number) => void;
  topOffset?: number;
}) {
  const n = scenes.length;
  // Every scene except the last gets a full 100vh of scroll runway; the
  // last gets a short LAST_SCENE_VH tail instead -- once it activates
  // there's nothing further to transition to, so a full extra 100vh of
  // scrolling after it was just dead space before the page actually
  // ended. Reported live, 2026-10-06 ("the last part... still has space
  // for scrolling down... stop the scrolling once the user reaches the
  // 'predicted...' formula").
  const LAST_SCENE_VH = 30;
  const totalVh = (n - 1) * 100 + LAST_SCENE_VH;
  return (
    <div style={{ position: "relative", height: `${totalVh}vh` }}>
      <div style={{ position: "sticky", top: -topOffset, height: "100vh", display: "flex", alignItems: "center" }}>
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
      {scenes.map((_, i) => {
        // Every scene before this one is a full 100vh, so scene i always
        // starts at i*100vh regardless of how short the final scene's own
        // slot is.
        const heightVh = i === n - 1 ? LAST_SCENE_VH : 100;
        return (
          <SceneTrigger
            key={i}
            index={i}
            topPercent={((i * 100) / totalVh) * 100}
            heightPercent={(heightVh / totalVh) * 100}
            onActivate={onActivate}
          />
        );
      })}
    </div>
  );
}
