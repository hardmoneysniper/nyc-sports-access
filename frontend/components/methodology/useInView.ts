import { useEffect, useRef, useState } from "react";

// Same IntersectionObserver-at-threshold reveal pattern already proven in
// app/page.tsx's StorySection -- an earlier sticky-pinned-container version
// of scroll animation on this project broke and was reverted, so every
// scrollytelling scene on the methodology page reuses this instead of a
// pinned/shared-state approach. Per project owner instruction, 2026-10-05.
export function useInView<T extends HTMLElement>(threshold = 0.5) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold });
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  return { ref, inView } as const;
}
