import { ApiEnvSchema } from '@fairground/types';

const result = ApiEnvSchema.safeParse(process.env);
if (!result.success) {
  console.error('API env validation failed:', result.error.issues);
  process.exit(1);
}

export const env = result.data;
