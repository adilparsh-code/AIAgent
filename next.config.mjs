/** @type {import('next').NextConfig} */

// MEDIUM-9 — baseline security response headers.
//
// The application shipped without any response security headers, so a browser
// had no instruction to resist MIME sniffing, framing, referrer leakage or
// aggressive feature access. These are deliberately conservative, additive
// headers only: no Content-Security-Policy is introduced here, because a CSP
// cannot be added safely without knowing every third-party origin each page
// loads, and a wrong CSP breaks the app rather than protecting it.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", "prisma"],
    allowedHosts: [".monkeycode-ai.live"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
