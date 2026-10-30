/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // fully client-side app: export to static HTML and serve from a CDN
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};
