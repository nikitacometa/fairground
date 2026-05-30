import { KeeperEnvSchema } from '@fairground/types';

const result = KeeperEnvSchema.safeParse(process.env);
if (!result.success) {
  console.error('Keeper env validation failed:', result.error.issues);
  process.exit(1);
}

export const env = result.data;
