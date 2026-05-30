import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Transpile workspace packages
  transpilePackages: ['@fairground/sdk', '@fairground/types', '@fairground/price-client'],

  // Strict mode in development
  reactStrictMode: true,

  // BigInt JSON serialization: bigints must be serialized as strings in API responses.
  // Next.js 16 handles this in Route Handlers but components must use .toString() manually.

  // Environment variables available to the browser (prefix NEXT_PUBLIC_)
  // Set via .env.local or Docker Compose environment block
  env: {
    NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: process.env['NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID'] ?? '',
    NEXT_PUBLIC_API_URL: process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3010',
    NEXT_PUBLIC_WS_URL: process.env['NEXT_PUBLIC_WS_URL'] ?? 'ws://localhost:3010/ws',
    NEXT_PUBLIC_COINFLIP_APP_ID: process.env['NEXT_PUBLIC_COINFLIP_APP_ID'] ?? '',
    NEXT_PUBLIC_TREASURY_APP_ID: process.env['NEXT_PUBLIC_TREASURY_APP_ID'] ?? '',
  },

  // Webpack: handle algosdk ESM imports in Next.js bundler
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };
    return config;
  },
};

export default nextConfig;
