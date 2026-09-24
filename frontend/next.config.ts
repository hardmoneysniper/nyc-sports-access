import type { NextConfig } from "next";

// GitHub Pages serves a project site from https://<user>.github.io/<repo>/,
// not the domain root, so every asset URL needs that /<repo> prefix baked
// in at build time -- basePath does this for next/link and the framework's
// own asset references. Plain fetch()/img src strings (see lib/basePath.ts)
// don't go through Next's URL rewriting and have to be prefixed by hand.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
};

export default nextConfig;
