/* eslint-disable @typescript-eslint/no-explicit-any */
import type { NextApiRequest } from "next";
import { defaultResponder } from "@calcom/lib/server";
import { ProviderFactory, CalendarProvider } from "../../services/providers";

interface UpdateSetupRequest {
  provider?: CalendarProvider;
  zuid?: string; // For backward compatibility
  userId: string;
  zoomUserId?: string;
  zohoCalendars?: Array<{
    externalId: string;
    credentialId: number;
    integration: string;
    selected: boolean;
  }>;
  calendars?: Array<{ // Generic calendar format
    externalId: string;
    credentialId: number;
    selected: boolean;
  }>;
  schedule?: {
    scheduleId: number;
    timeZone: string;
    name: string;
    isDefault: boolean;
    schedule: Array<Array<{ start: string; end: string }>>;
    dateOverrides: Array<{ start: string; end: string }>;
  };
}

export async function patchHandler(req: NextApiRequest) {
  const body = req.body as UpdateSetupRequest;

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
  const externalUserId = body.zuid || body.userId;

  // Prepare schedule data if provided
  let scheduleData = undefined;
  if (body.schedule) {
    scheduleData = {
      availability: body.schedule.schedule,
      timeZone: body.schedule.timeZone,
      name: body.schedule.name,
    };
  }

  // Handle calendars - support both old zohoCalendars and new calendars format
  const calendars = body.calendars || body.zohoCalendars?.map(cal => ({
    externalId: cal.externalId,
    credentialId: cal.credentialId,
    selected: cal.selected,
  }));

  // Update setup using provider
  const result = await providerService.updateSetup({
    userId: externalUserId,
    schedule: scheduleData,
    zoomUserId: body.zoomUserId,
    calendars,
  });

  if (!result.success) {
    return {
      error: result.error,
      message: result.error,
    };
  }

  return {
    message: "Managed setup updated successfully",
    data: {
      provider,
      status: "Updated",
    },
  };
}

export default defaultResponder(patchHandler);