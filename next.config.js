/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // /api/arcade reads the arcade page source from disk at request time.
    outputFileTracingIncludes: { '/api/arcade': ['./arcade/src/Main.dc.html'] },
  },
  async redirects() {
    return [
      {
        source: '/billing',
        destination: '/bookkeeping',
        permanent: true,
      },
      {
        source: '/admin/brex',
        destination: '/bookkeeping',
        permanent: true,
      },
      {
        source: '/admin/duplicates',
        destination: '/bookkeeping?tab=duplicates',
        permanent: true,
      },
    ];
  },
}

module.exports = nextConfig
