"use client";

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

// Black background / white text throughout, per project owner
// instruction, 2026-09-28.
const HEADING_STYLE: CSSProperties = {
  fontSize: 40,
  fontWeight: 700,
  lineHeight: 1.25,
  whiteSpace: "nowrap",
  color: "#fff",
};

// Cycles "How close is the <sport venue>" through SPORT_WORDS with a
// typewriter effect: types the venue, pauses, deletes it, types the next.
function TypewriterHeading() {
  const [wordIndex, setWordIndex] = useState(0);
  const [subLength, setSubLength] = useState(0);
  const [phase, setPhase] = useState<"typing" | "deleting">("typing");

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
          background: "#fff",
          verticalAlign: "middle",
          transform: "translateY(-0.05em)",
        }}
      />
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
// to slot 0.
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

// Each scrolled-to statement, two lines (headline + supporting line).
const STORY_STEPS: { headline: string; body: string }[] = [
  {
    headline: "More people should mean more places to play.",
    body: "You would expect neighborhoods with more residents to have better access to public sports facilities.",
  },
  {
    headline: "But that’s not always what we found.",
    body: "Across New York City, population and access to sports facilities do not always line up.",
  },
  {
    headline: "Some neighborhoods have much less access than others.",
    body: "We highlight places where access to specific sports facilities falls short, and look at who lives in those neighborhoods (including immigrant and lower-income communities.)",
  },
  {
    headline: "That can help show where investment is needed.",
    body: "By comparing population, demographics, and access across different sports, the project points to neighborhoods where new or improved facilities could make the biggest difference.",
  },
];

// senseable.mit.edu/shaded-politics's own text sections (#intro,
// #introMap) are plain `h-screen` sections in normal document flow -- no
// absolute stacking, no position:sticky, no JS-computed transform at all.
// The only pinned/scroll-scrubbed element on that whole page is their
// title *video*, which needs continuous scrubbing; ordinary text just
// scrolls natively. An earlier version of this page tried to stack every
// section inside one big sticky-pinned container with a hand-rolled
// scroll-progress calculation, which is what broke (only the first
// section ever showed, with a black remainder underneath). Rebuilt to
// match their actual, much simpler structure. Per project owner
// instruction, 2026-09-28.
function StorySection({ headline, body }: { headline: string; body: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.5 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={ref}
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "0 96px",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          opacity: inView ? 1 : 0,
          transform: inView ? "translateY(0)" : "translateY(24px)",
          transition: "opacity 700ms ease, transform 700ms ease",
        }}
      >
        <p style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.35, color: "#fff", maxWidth: 820, margin: 0 }}>
          {headline}
        </p>
        <p style={{ fontSize: 19, lineHeight: 1.6, color: "#fff", maxWidth: 680, marginTop: 24 }}>{body}</p>
      </div>
    </section>
  );
}

export default function LandingPage() {
  return (
    <div style={{ background: "#000" }}>
      <section style={{ height: "100vh", display: "flex" }}>
        <div style={{ flex: "0 0 50%", display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 40px" }}>
          <TypewriterHeading />
        </div>
        <div style={{ flex: "0 0 50%" }}>
          <ImageCarousel />
        </div>
      </section>

      {STORY_STEPS.map((s, i) => (
        <StorySection key={i} headline={s.headline} body={s.body} />
      ))}
    </div>
  );
}
