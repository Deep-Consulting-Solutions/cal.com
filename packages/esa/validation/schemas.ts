import { z } from "zod";

import { ZUpdateInputSchema } from "@calcom/trpc/server/routers/viewer/availability/schedule/update.schema";

export const setupManagedZohoUserRequestSchema = z.object({
  zuid: z.string(),
  email: z.string().email(),
  name: z.string(),
  timeZone: z.string(),
  schedule: z
    .array(
      z.array(
        z.object({
          start: z.coerce.date(),
          end: z.coerce.date(),
        })
      )
    )
    .optional(),
  zoomUserId: z.string(),
});

export const updateManagedZohoUserRequestSchema = z.object({
  userId: z.number(),
  zuid: z.string(),
  schedule: ZUpdateInputSchema,
  zoomUserId: z.string(),
  zohoCalendars: z.array(
    z.object({
      externalId: z.string(),
      credentialId: z.coerce.number(),
      integration: z.string(),
      selected: z.boolean(),
    })
  ),
});
