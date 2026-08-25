import { z } from "zod";

const baseServerEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(32),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  METRICS_TOKEN: z.string().min(32).optional(),
});

export const serverEnvSchema = baseServerEnvSchema.superRefine((value, context) => {
  if (value.NODE_ENV === "production" && !value.METRICS_TOKEN) {
    context.addIssue({
      code: "custom",
      path: ["METRICS_TOKEN"],
      message: "METRICS_TOKEN is required in production.",
    });
  }
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(input: NodeJS.ProcessEnv = process.env): ServerEnv {
  return serverEnvSchema.parse(input);
}

export function isServerEnvReady(input: NodeJS.ProcessEnv = process.env): boolean {
  return serverEnvSchema.safeParse(input).success;
}
