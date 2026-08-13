import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Pin the workspace root. Without this, Turbopack walks up to the user's home
  // directory looking for a lockfile and warns about the one it finds there.
  turbopack: {
    root: path.resolve(__dirname),
  },

  // `typedRoutes` is deliberately off: the sidebar is data-driven and the
  // post-login redirect comes from a query parameter, so hrefs are strings by
  // nature. Turning it on would only add casts at those boundaries.
};

export default nextConfig;
