/** @type {import('next').NextConfig} */
const nextConfig = {
  // `pg` is a Node-only dependency used by the API route; keep it external.
  serverExternalPackages: ["pg"],
  // This app has its own lockfile; root tracing at the viewer dir silences the
  // multi-lockfile warning.
  outputFileTracingRoot: import.meta.dirname,
};

export default nextConfig;
