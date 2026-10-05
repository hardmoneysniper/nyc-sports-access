import type { ReactNode } from "react";

// Wraps a scrollytelling diagram (chart/map) + its caption so both are
// centered to a percentage of whatever width is actually available to the
// content pane -- which already shrinks/grows on its own as the
// methodology catalog panel opens and closes, since this sits inside that
// flex layout. A plain CSS percentage (not a JS-measured pixel width) is
// what makes this track the panel's open/close state and window resizes
// with no ResizeObserver needed. Per project owner instruction, 2026-10-05.
export default function CenteredDiagram({
  widthPercent = 80,
  maxWidth,
  caption,
  children,
}: {
  widthPercent?: number;
  maxWidth?: number;
  caption?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div style={{ width: `${widthPercent}%`, maxWidth, margin: "0 auto" }}>
      {children}
      {caption && <p style={{ marginTop: 12, fontSize: 15, color: "#ccc", textAlign: "center" }}>{caption}</p>}
    </div>
  );
}
