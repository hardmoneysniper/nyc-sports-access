// Mirrors next.config.ts's basePath. next/link and Next's own asset
// pipeline apply basePath automatically, but plain fetch() URLs and <img>
// src strings don't go through that -- anything using a literal "/..."
// path needs to be prefixed with this by hand.
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function withBasePath(path: string): string {
  return `${BASE_PATH}${path}`;
}
