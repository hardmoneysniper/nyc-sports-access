"use client";

import type { ReactNode } from "react";

// Fixed two-column layout per travel-time-page.png/burden-score-page.png:
// explanatory text on the left, the diagram auto-cycling through its
// states in a bordered box on the right -- no scrolling involved at all.
// Replaces the scroll-driven PinnedScrollSequence layout. The box is a
// thin border on transparent/black fill (not the mockups' literal light
// grey placeholder swatch), matching this project's established dark
// theme. Per project owner instruction, 2026-10-08.
//
// activeIndex is a controlled prop (the caller owns its own useAutoLoop
// call), not managed internally -- some callers (TravelTimeTab) need to
// know which scene is active OUTSIDE this component too, to drive a
// scene-specific animation (the staggered route reveal only plays while
// that scene is the active one).
export default function SplitPanel({
  children,
  scenes,
  backdrop,
  captions,
  activeIndex,
  aspectRatio = "4 / 3",
  rightFlex = 1,
  leftWidth,
  boxMaxWidth,
  sceneBottomPadding = 0,
}: {
  // Left column content, heading included (h1/h2, whichever the caller
  // needs) -- no dedicated title prop, since where the heading sits
  // (above just the left column vs spanning both) differs between the
  // two pages' mockups.
  children: ReactNode;
  scenes: ReactNode[];
  // Rendered once, behind every scene, never swapped/duplicated -- for
  // content that's identical across all scenes (e.g. Travel Time's real
  // street-network layer, ~9k polylines). Mounting that per-scene instead
  // of once quadrupled the DOM's heaviest content and made any reflow-
  // triggering layout change (like this page's own menu-collapse
  // animation) visibly stutter. Reported live, 2026-10-08 ("stucks and
  // fps drops when I hit hide menu / show menu").
  backdrop?: ReactNode;
  // Optional, rolls in sync with scenes (same activeIndex) in a fixed-
  // height area below the animation box -- not every caller needs this
  // (Burden Score's chart states are self-explanatory via the left
  // column alone).
  captions?: ReactNode[];
  activeIndex: number;
  // No longer hardcoded -- Travel Time's maps are 4:3, Burden Score's
  // chart is square; a fixed aspect ratio either left dead space around
  // the content or clipped it depending on which page used it. Reported
  // live, 2026-10-08 ("adjust the white boundary to fit the size of the
  // animation itself").
  aspectRatio?: string;
  // Flex-grow for the right (box) column relative to the left column's
  // fixed grow of 1 -- widens the box in absolute pixels without
  // touching aspectRatio (which only sets height *relative to whatever
  // width the column ends up with*, not the width itself). Burden
  // Score's chart needs a wider box to give its point labels room to
  // spill into. Reported live, 2026-10-08.
  rightFlex?: number;
  // Fixed pixel width for the left (text) column, replacing its default
  // flexible ~half-of-the-row sizing -- the box's own right edge is only
  // ever guaranteed to land exactly on the row's own right edge (same
  // right edge every other full-width section on the page already lands
  // on) when the left column's width isn't itself competing for the same
  // free space via flex-grow. With a fixed left column, the right (box)
  // column's flex-grow has nothing left to compete with and simply claims
  // 100% of whatever remains. Reported live, 2026-10-08 ("disregard the
  // half-half layout... the right end of the container is no longer
  // aligned with the right end of the text").
  leftWidth?: number;
  // Caps the box's own width below its column's full width -- without
  // this, aspectRatio derives the box's height from the FULL column
  // width, not from however much smaller the diagram inside it actually
  // is, leaving the box a big square with dead space around a small
  // diagram. Reported live, 2026-10-08 ("shrink the container vertically
  // to fit the diagram comfortably").
  boxMaxWidth?: number;
  // Reserves blank space along the box's bottom edge (px), pushing the
  // scene content up within the box's otherwise-unchanged outer size --
  // absolutely-positioned scene children fill the box's padding edge
  // regardless of CSS `padding` on the box itself, so this is threaded
  // through as an explicit `bottom` inset instead. Reported live,
  // 2026-10-08 ("increase vertical padding on the bottom").
  sceneBottomPadding?: number;
}) {
  return (
    <div style={{ display: "flex", gap: 64, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={leftWidth ? { flex: `0 0 ${leftWidth}px` } : { flex: "1 1 420px", minWidth: 320 }}>{children}</div>
      <div style={{ flex: leftWidth ? "1 1 auto" : `${rightFlex} 1 420px`, minWidth: 320 }}>
        <div style={{ position: "relative", aspectRatio, maxWidth: boxMaxWidth, border: "1px solid #444" }}>
          {backdrop && (
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: sceneBottomPadding }}>{backdrop}</div>
          )}
          {scenes.map((scene, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: sceneBottomPadding,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: i === activeIndex ? 1 : 0,
                transition: "opacity 300ms ease",
                pointerEvents: i === activeIndex ? "auto" : "none",
              }}
            >
              {scene}
            </div>
          ))}
        </div>
        {captions && (
          <div style={{ position: "relative", marginTop: 16, minHeight: 56 }}>
            {captions.map((caption, i) => (
              <div
                key={i}
                style={{
                  position: "absolute",
                  inset: 0,
                  fontSize: 16,
                  color: "#ccc",
                  lineHeight: 1.5,
                  opacity: i === activeIndex ? 1 : 0,
                  transition: "opacity 300ms ease",
                }}
              >
                {caption}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
