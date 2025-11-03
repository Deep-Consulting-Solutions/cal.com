/* eslint-disable @typescript-eslint/no-explicit-any */
import type { NextApiRequest } from "next";

import { defaultResponder } from "@calcom/lib/server";

import { ProviderFactory, CalendarProvider } from "../../services/providers";

interface CreateSetupRequest {
  provider?: CalendarProvider;
  zuid?: string; // For backward compatibility
  userId?: string; // Generic user ID
  email: string;
  name: string;
  timeZone: string;
  schedule: Array<Array<{ start: string; end: string }>>;
  zoomUserId?: string;
}

export async function postHandler(req: NextApiRequest) {
  const body = req.body as CreateSetupRequest;

  // Get provider - default to zoho for backward compatibility
  const provider = (body.provider || "zoho") as CalendarProvider;

  // Validate provider configuration
  const validation = ProviderFactory.validateProvider(provider);
  if (!validation.valid) {
    return {
      error: validation.error,
      message: validation.error,
    };
  }

  // Get provider service
  const providerService = ProviderFactory.getProvider(provider);

  // Use zuid for backward compatibility, or userId for new implementations
  const externalUserId = body.zuid || body.userId || "";

  // Create setup using provider
  const result = await providerService.createSetup({
    userId: externalUserId,
    email: body.email,
    name: body.name,
    timeZone: body.timeZone,
    schedule: {
      availability: body.schedule,
      timeZone: body.timeZone,
      name: `${body.name}'s Schedule`,
    },
    zoomUserId: body.zoomUserId,
  });

  if (!result.success) {
    return {
      error: result.error,
      message: result.error,
    };
  }

  return {
    message: "Managed setup in progress",
    data: {
      url: result.oauthUrl,
      provider,
      status: "Pending Completion",
    },
  };
}

export default defaultResponder(postHandler);
