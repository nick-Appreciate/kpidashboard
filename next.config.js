/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
