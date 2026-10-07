import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV !== "production";
const explicitApiOrigin = process.env.NEXT_PUBLIC_API_BASE_URL;
let apiOrigin = "";

if (explicitApiOrigin) {
  try {
    apiOrigin = new URL(explicitApiOrigin).origin;
  } catch {
    // The API client will surface an invalid runtime URL. Do not put an
    // untrusted value into a response header while the app is starting.
  }
}

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
  `connect-src 'self'${apiOrigin ? ` ${apiOrigin}` : ""}`,
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  skipTrailingSlashRedirect: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/favicon.ico",
        destination: "/brand/favicon-48.png",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
