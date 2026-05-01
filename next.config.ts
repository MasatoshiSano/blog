import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  // eslint は `npm run lint` で別途実行する。next build 中に走らせると
  // pre-existing の React 19 strict rule (set-state-in-effect 等) で
  // 既存パターンが build を止めるため、ビルド時は skip する。
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
