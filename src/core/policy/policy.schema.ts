import { z } from 'zod'

import { ALL_FLAG_KINDS } from '../flags/flag.registry.js'

const severityEnum = z.enum(['info', 'warning', 'critical', 'off'])

const ruleConfigSchema = z.union([
  severityEnum,
  z.object({
    level: severityEnum,
    thresholdDays: z.number().positive().optional(),
  }),
])

const licensePolicySchema = z.object({
  allow: z.array(z.string()).default([]),
  deny: z.array(z.string()).default([]),
  unknown: z.enum(['info', 'warning', 'critical']).default('warning'),
})

const waiverSchema = z.object({
  package: z.string().min(1),
  flag: z.enum(ALL_FLAG_KINDS as unknown as [string, ...string[]]),
  reason: z.string().min(1),
  expires: z.string().optional(),
})

const cacheConfigSchema = z.object({
  maxAge: z
    .object({
      registry: z.string().optional(),
      github: z.string().optional(),
      vulnerability: z.string().optional(),
      downloads: z.string().optional(),
    })
    .optional(),
  maxSize: z.string().optional(),
  directory: z.string().optional(),
})

/**
 * Zod schema for .dep-inspect.json policy file.
 * Provides runtime validation with clear error messages.
 */
export const policyConfigSchema = z.object({
  severity: z.record(z.string(), ruleConfigSchema).default({}),
  licenses: licensePolicySchema.default({
    allow: [],
    deny: [],
    unknown: 'warning',
  }),
  ci: z
    .object({
      failOn: z.enum(['info', 'warning', 'critical']).default('critical'),
    })
    .default({ failOn: 'critical' }),
  cache: cacheConfigSchema.optional(),
  waivers: z.array(waiverSchema).default([]),
})
