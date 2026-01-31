/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@jobforge/ui'],

  // Performance optimizations
  compress: true,
  poweredByHeader: false,

  // Image optimization
  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 60,
  },

  // Experimental optimizations
  experimental: {
    optimizePackageImports: ['@jobforge/ui'],
  },

  // Bundle analyzer (optional, enable via env var)
  ...(process.env.ANALYZE === 'true' && {
    webpack: (config) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer')
      config.plugins.push(
        new BundleAnalyzerPlugin({
          analyzerMode: 'static',
          reportFilename: './analyze.html',
          openAnalyzer: false,
        })
      )
      return config
    },
  }),
}

module.exports = nextConfig
