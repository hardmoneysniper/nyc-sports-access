"use client";

import type { ReactNode } from "react";
import { useInView } from "./useInView";

// One scroll-triggered step of a scrollytelling sequence -- fades/slides in
// once >=40% visible, stays visible once shown (no re-trigger loop).
// children may be a render function (inView: boolean) => ReactNode for
// scenes that need to stagger their OWN internal elements (e.g. routes
// fading in one at a time) off the same inView flag that drives the
// scene's own fade. Per project owner instruction, 2026-10-05.
export default function Scene({
  children,
  minHeight,
}: {
  children: ReactNode | ((inView: boolean) => ReactNode);
  minHeight?: number;
}) {
  const { ref, inView } = useInView<HTMLDivElement>(0.4);
  return (
    <div
      ref={ref}
      style={{
        padding: "56px 0",
        minHeight,
        opacity: inView ? 1 : 0,
        transform: inView ? "translateY(0)" : "translateY(20px)",
        transition: "opacity 500ms ease, transform 500ms ease",
      }}
    >
      {typeof children === "function" ? children(inView) : children}
    </div>
  );
}
