/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@fairground/sdk',
    '@fairground/types',
    '@fairground/price-client',
    '@fairground/nfd',
  ],

  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
    NEXT_PUBLIC_ALGORAND_NETWORK: process.env.NEXT_PUBLIC_ALGORAND_NETWORK,
    NEXT_PUBLIC_COINFLIP_APP_ID: process.env.NEXT_PUBLIC_COINFLIP_APP_ID,
    NEXT_PUBLIC_MIN_BET_MICROALGO: process.env.NEXT_PUBLIC_MIN_BET_MICROALGO,
    NEXT_PUBLIC_MAX_BET_MICROALGO: process.env.NEXT_PUBLIC_MAX_BET_MICROALGO,
  },
};

export default nextConfig;
