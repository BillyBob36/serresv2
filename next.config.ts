import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  ...(process.env.STATIC_EXPORT === "true"
    ? { output: "export" as const, images: { unoptimized: true } }
    : {}),
};

export default nextConfig;
