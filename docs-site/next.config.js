/** @type {import('next').NextConfig} */

// A GitHub Pages project site is served under /<repository>, so the deploy
// workflow passes that prefix at build time. An empty value serves the site at
// a domain root, which is what a custom domain needs.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig = {
  output: "export",
  basePath,
  assetPrefix: basePath || undefined,
  // Expose the base path to client/runtime code so raw string asset paths
  // (search index fetch, <img> src, etc.) can be prefixed manually — Next only
  // applies basePath automatically to <Link>, next/image and /_next assets.
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;
