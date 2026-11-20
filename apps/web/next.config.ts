import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@archmind/contracts", "@archmind/domain"],
  webpack(config: { resolve: { extensionAlias?: Record<string, string[]> } }) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"]
    };
    return config;
  }
};

export default config;
