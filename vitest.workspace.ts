import { defineWorkspace } from 'vitest/config';

// Inline workspace: picks up any vitest.config.ts that exists in a package, and
// falls back to a sensible inline config for packages that don't have one yet.
// This avoids hard-failing when a per-package config file hasn't been created.
export default defineWorkspace([
  {
    test: {
      name: 'sdk',
      include: ['packages/sdk/src/**/*.{test,spec}.ts'],
      environment: 'node',
    },
  },
  {
    test: {
      name: 'types',
      include: ['packages/types/src/**/*.{test,spec}.ts'],
      environment: 'node',
    },
  },
  {
    test: {
      name: 'db',
      include: ['packages/db/src/**/*.{test,spec}.ts'],
      environment: 'node',
    },
  },
  {
    test: {
      name: 'api',
      include: ['packages/api/src/**/*.{test,spec}.ts'],
      environment: 'node',
    },
  },
  {
    test: {
      name: 'keeper',
      include: ['packages/keeper/src/**/*.{test,spec}.ts'],
      environment: 'node',
    },
  },
  {
    test: {
      name: 'proof-card',
      include: ['packages/proof-card/src/**/*.{test,spec}.ts'],
      environment: 'node',
    },
  },
  {
    test: {
      name: 'price-client',
      include: ['packages/price-client/src/**/*.{test,spec}.ts'],
      environment: 'node',
    },
  },
  {
    test: {
      name: 'nfd',
      include: ['packages/nfd/src/**/*.{test,spec}.ts'],
      environment: 'node',
    },
  },
  {
    test: {
      name: 'game',
      include: ['apps/game/**/*.{test,spec}.{ts,tsx}'],
      environment: 'jsdom',
    },
  },
]);
