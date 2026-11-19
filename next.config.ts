import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  experimental: {
    agentUpgrade: "security",
  },
};

module.exports = {
  allowedDevOrigins: ['localhost','10.0.42.72'],
}

export default nextConfig;
