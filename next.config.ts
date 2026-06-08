import type { NextConfig } from "next";

const nextConfig: NextConfig = {

  // TODO: Remove this once on production
  async rewrites() {
    return [
      {
        source: '/backend/:path*',
        destination:
          'https://snivra-be-production.up.railway.app/api/v1/:path*',
      },
    ]
  },

  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
