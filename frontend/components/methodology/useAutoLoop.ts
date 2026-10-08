import { useEffect, useState } from "react";

// Drives an auto-cycling diagram state -- advances (i+1)%count every
// intervalMs, looping forever, with no scroll/IntersectionObserver
// involved at all. Replaces the scroll-driven PinnedScrollSequence
// mechanism per the travel-time/burden-score page mockups ("the animation
// should be automatically playing in a loop with each state lasting 1
// second"). Per project owner instruction, 2026-10-08.
export function useAutoLoop(count: number, intervalMs = 1000): number {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (count <= 1) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % count), intervalMs);
    return () => clearInterval(id);
  }, [count, intervalMs]);
  return index;
}
