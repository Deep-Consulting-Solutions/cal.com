/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PrismaClient } from "@prisma/client";
import type { NextApiRequest } from "next";
import { defaultResponder } from "@calcom/lib/server";
import { getScheduleByUserIdHandler } from "@calcom/trpc/server/routers/viewer/availability/schedule/getScheduleByUserId.handler";
import { ProviderFactory, CalendarProvider } from "../../services/providers";

export async function getHandler(req: NextApiRequest) {
  const $req = req as NextApiRequest & { prisma: any };
  const prisma: PrismaClient = $req.prisma;

  // Get provider from query param, default to zoho for backward compatibility
  const providerParam = (req.query.provider as string) || "zoho";
  const provider = providerParam as CalendarProvider;

  // Validate provider
  const validation = ProviderFactory.validateProvider(provider);
  if (!validation.valid) {
    return {
      error: validation.error,
      crmUsers: [],
    };
  }

  // Get provider service
  const providerService = ProviderFactory.getProvider(provider);

  // Fetch users from provider
  const providerUsers = await providerService.fetchUsers();

  // Map to expected format with schedules
  const crmUsers = await Promise.all(
    providerUsers.map(async (user) => {
      let schedule = null;

      if (user.userId) {
        const contextUser = { id: parseInt(user.userId), timeZone: user.timeZone };
        try {
          schedule = await getScheduleByUserIdHandler({
            ctx: { user: contextUser, prisma },
            input: { userId: parseInt(user.userId) },
          } as any);
        } catch (error) {
          console.error(`Failed to fetch schedule for user ${user.userId}:`, error);
        }
      }

      return {
        userId: user.userId,
        zuid: user.id, // Generic ID field
        zoomUserId: user.zoomUserId,
        email: user.email,
        emailAddresses: [user.email.toLowerCase()],
        name: user.name,
        hasZohoCalender: user.hasCalendar, // Keep field name for backward compatibility
        timeZone: user.timeZone,
        status: user.status,
        schedule,
        provider: provider, // Add provider info
      };
    })
  );

  return {
    crmUsers,
    provider,
    availableProviders: ProviderFactory.getAvailableProviders(),
  };
}

export default defaultResponder(getHandler);