/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // Event imagery is served locally in development; remote patterns are
    // added per-source as importers come online.
    remotePatterns: [],
  },
};

export default nextConfig;
