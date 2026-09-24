"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { withBasePath } from "@/lib/basePath";

const SPORT_WORDS = ["soccer field?", "basketball court?", "tennis court?", "baseball field?", "running track?"];
const HEADING_PREFIX = "How close is the ";
const CAROUSEL_IMAGES = ["/imgs/1.png", "/imgs/2.png", "/imgs/3.png", "/imgs/4.png"].map(withBasePath);

const TYPE_MS = 70;
const DELETE_MS = 35;
const PAUSE_MS = 1600;
const WORD_GAP_MS = 250;

const HEADING_STYLE: CSSProperties = {
  fontSize: 40,
  fontWeight: 700,
  lineHeight: 1.25,
  whiteSpace: "nowrap",
  color: "#000",
};

// Cycles "How close is the <sport venue>" through SPORT_WORDS with a
// typewriter effect: types the venue, pauses, deletes it, types the next.
// The measured width (widest full phrase, via a hidden offscreen copy of
// all 5 phrases) is reported up to the parent via onMeasured so the
// paragraph below can share the exact same width/left edge instead of
// being centered independently. Per project owner instruction,
// 2026-09-26 (and refined 2026-09-27 to left-align the paragraph to the
// heading while widening it to fit more words per line).
function TypewriterHeading({ onMeasured }: { onMeasured: (width: number) => void }) {
  const [wordIndex, setWordIndex] = useState(0);
  const [subLength, setSubLength] = useState(0);
  const [phase, setPhase] = useState<"typing" | "deleting">("typing");
  const measureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    let max = 0;
    Array.from(el.children).forEach((child) => {
      const w = (child as HTMLElement).getBoundingClientRect().width;
      if (w > max) max = w;
    });
    onMeasured(Math.ceil(max));
    // onMeasured is a stable setter from the parent; only needs to run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const currentWord = SPORT_WORDS[wordIndex];

    if (phase === "typing") {
      if (subLength < currentWord.length) {
        const t = setTimeout(() => setSubLength((n) => n + 1), TYPE_MS);
        return () => clearTimeout(t);
      }
      const t = setTimeout(() => setPhase("deleting"), PAUSE_MS);
      return () => clearTimeout(t);
    }

    // deleting
    if (subLength > 0) {
      const t = setTimeout(() => setSubLength((n) => n - 1), DELETE_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setWordIndex((i) => (i + 1) % SPORT_WORDS.length);
      setPhase("typing");
    }, WORD_GAP_MS);
    return () => clearTimeout(t);
  }, [phase, subLength, wordIndex]);

  const visibleWord = SPORT_WORDS[wordIndex].slice(0, subLength);

  return (
    <div>
      <div
        ref={measureRef}
        aria-hidden
        style={{ position: "absolute", visibility: "hidden", height: 0, overflow: "hidden", ...HEADING_STYLE }}
      >
        {SPORT_WORDS.map((word) => (
          <div key={word}>
            {HEADING_PREFIX}
            {word}
          </div>
        ))}
      </div>
      <div style={{ textAlign: "left", ...HEADING_STYLE }}>
        {HEADING_PREFIX}
        {visibleWord}
        <span
          className="typewriter-cursor"
          style={{
            display: "inline-block",
            width: 3,
            height: "0.75em",
            marginLeft: 4,
            background: "#000",
            verticalAlign: "middle",
            transform: "translateY(-0.05em)",
          }}
        />
      </div>
    </div>
  );
}

const ROTATE_MS = 2500;
const SLIDE_MS = 800;

// Vertical "rolling" carousel: slides up to the next image every
// ROTATE_MS. A duplicate of the first image is appended as a 5th slot so
// the loop from image 4 back to image 1 can slide (rather than snap) --
// once that slide finishes, the transform resets to slot 0 instantly
// (transition disabled for one frame) since slot 4 is visually identical
// to slot 0. Per project owner instruction, 2026-09-26.
function ImageCarousel() {
  const [index, setIndex] = useState(0);
  const [animate, setAnimate] = useState(true);
  const slides = [...CAROUSEL_IMAGES, CAROUSEL_IMAGES[0]];

  useEffect(() => {
    const id = setInterval(() => setIndex((i) => i + 1), ROTATE_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (index !== CAROUSEL_IMAGES.length) return;
    const t = setTimeout(() => {
      setAnimate(false);
      setIndex(0);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setAnimate(true));
      });
    }, SLIDE_MS);
    return () => clearTimeout(t);
  }, [index]);

  return (
    <div style={{ position: "relative", height: "100%", width: "100%", overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: `${slides.length * 100}%`,
          transform: `translateY(-${(index / slides.length) * 100}%)`,
          transition: animate ? `transform ${SLIDE_MS}ms ease-in-out` : "none",
        }}
      >
        {slides.map((src, i) => (
          <div key={i} style={{ height: `${100 / slides.length}%`, width: "100%" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function LandingPage() {
  // Shared width for both the heading and the paragraph below it, so the
  // paragraph's left edge lines up with "How close is the..." instead of
  // being centered independently at a narrower width. Widening it to the
  // heading's own (wider) measured width also means the paragraph wraps
  // into fewer, fuller lines. Per project owner instruction, 2026-09-27.
  const [contentWidth, setContentWidth] = useState<number | null>(null);

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw", overflow: "hidden", background: "#fff" }}>
      <div style={{ flex: "0 0 50%", position: "relative", display: "flex", flexDirection: "column", background: "#fff" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 40px" }}>
          <div style={{ width: contentWidth ?? undefined, margin: "0 auto" }}>
            <TypewriterHeading onMeasured={setContentWidth} />
            <p
              style={{
                marginTop: 32,
                fontSize: 20,
                lineHeight: 1.5,
                textAlign: "left",
                color: "#111",
              }}
            >
              Explore access to public sports facilities across New York City and see how it varies across neighborhoods and communities.
            </p>
          </div>
        </div>
        <Link href="/explore" style={{ position: "absolute", bottom: 48, left: "50%", transform: "translateX(-50%)" }}>
          <button
            style={{
              color: "#000",
              background: "#fff",
              border: "1px solid #d0d0d0",
              borderRadius: 6,
              padding: "12px 28px",
              cursor: "pointer",
              textAlign: "center",
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1 }}>EXPLORE NYC</span>
          </button>
        </Link>
      </div>
      <div style={{ flex: "0 0 50%" }}>
        <ImageCarousel />
      </div>
    </div>
  );
}
