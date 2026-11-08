import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A static export (out/) served from S3 behind CloudFront - no Node.js server to run or patch.
  // Every page fetches its data in the browser, so stock and orders are always current.
  output: "export",
  // /products/ is written as products/index.html; the CloudFront function maps URLs onto these files
  trailingSlash: true,
  // The default image loader needs a server; the product illustrations are SVGs, which aren't resized anyway
  images: { unoptimized: true },
};

export default nextConfig;
