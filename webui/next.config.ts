import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Proxy API requests to Hermes Agent backend in development
  async rewrites() {
    return [
      {
        source: '/api/hermes/:path*',
        destination: 'http://localhost:8642/v1/:path*',
      },
    ];
  },
};

export default nextConfig;
