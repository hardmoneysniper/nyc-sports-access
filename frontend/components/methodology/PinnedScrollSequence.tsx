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
  threshold,
  onActivate,
}: {
  index: number;
  topPercent: number;
  heightPercent: number;
  threshold: number;
  onActivate: (index: number) => void;
}) {
  const { ref, inView } = useInView<HTMLDivElement>(threshold);
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
  // Every scene gets a full 100vh slot, including the last -- a
  // 100vh-tall sticky element can only stay fully pinned while the track
  // has at least 100vh of height remaining below it; shrinking the last
  // slot below that made the sticky box start releasing (sliding away)
  // DURING the second-to-last scene, so the final scene appeared already
  // partway off-screen, and the user scrolled through blank space for
  // the remainder of the track. Reported live, 2026-10-06 ("a little bit
  // of scroll exceeding the page's bottom"). The earlier complaint this
  // was shrunk for ("dead space before reaching the final formula") is
  // instead fixed below by firing the last scene's trigger almost
  // immediately on entering its zone, instead of waiting for the 50%
  // point like every other scene.
  const totalVh = n * 100;
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
      {scenes.map((_, i) => (
        <SceneTrigger
          key={i}
          index={i}
          topPercent={(i / n) * 100}
          heightPercent={(1 / n) * 100}
          // The last scene fires almost as soon as its zone is entered
          // (instead of waiting for 50% visible like every other scene),
          // so it's on screen for nearly its whole 100vh slot rather than
          // just the back half -- that's what makes the scroll down to it
          // feel continuous instead of like there's a dead stretch first.
          threshold={i === n - 1 ? 0.05 : 0.5}
          onActivate={onActivate}
        />
      ))}
    </div>
  );
}
