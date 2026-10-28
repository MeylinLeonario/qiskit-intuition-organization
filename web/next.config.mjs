/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  turbopack: { root: process.cwd() },
  transpilePackages: ["three"],
};

export default nextConfig;
