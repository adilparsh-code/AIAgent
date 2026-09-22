/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", "prisma"],
    allowedHosts: [".monkeycode-ai.live"],
  },
};

export default nextConfig;
