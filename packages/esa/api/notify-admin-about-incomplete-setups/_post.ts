/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PrismaClient } from "@prisma/client";
import type { NextApiRequest } from "next";

import { defaultResponder } from "@calcom/lib/server";
import Office365CalendarService from "@calcom/office365calendar/lib/CalendarService";
import ZohoCalendarService from "@calcom/zohocalendar/lib/CalendarService";

import { sendMail } from "../../lib/mailer";
import incompleteSetupReminderEmail from "../../lib/mailer/templates/incompleteSetupReminderEmail";
import { ProviderFactory } from "../../services/providers";
import { getHandler as getZohoManagedCrmUsers } from "../managed-zoho-crm-users/_get";

async function postHandler(req: NextApiRequest) {
  const $req = req as NextApiRequest & { prisma: any };
  const prisma: PrismaClient = $req.prisma;

  const incompleteSetups: { email: string; pendingTasks: string[] }[] = [];

  // Get available providers
  const availableProviders = ProviderFactory.getAvailableProviders();

  // Process each provider
  for (const provider of availableProviders) {
    const providerService = ProviderFactory.getProvider(provider);

    // Get users for this provider
    let users: any[] = [];

    if (provider === "zoho") {
      // For Zoho, use the existing endpoint
      const result = await getZohoManagedCrmUsers(req);
      users = result.crmUsers || [];
    } else {
      // For other providers, fetch from ManagedSchedulingSetup
      const managedSetups = await prisma.managedSchedulingSetup.findMany({
        where: { provider },
        include: {
          user: {
            include: {
              schedules: true,
            },
          },
        },
      });

      users = managedSetups.map((setup: any) => ({
        email: setup.user.email,
        emailAddresses: [setup.user.email],
        status: setup.status,
        userId: setup.userId,
        provider,
      }));
    }

    // Check each user
    for (const user of users) {
      const pendingTasks: string[] = [];
      const providerName = providerService.getDisplayName();

      // Check if setup is pending
      if (user.status === "Pending Completion") {
        incompleteSetups.push({
          email: user.email,
          pendingTasks: [`${providerName} setup has not been completed`],
        });
        continue;
      }

      // Find the Cal.com user
      const calUser = await prisma.user.findFirst({
        where: {
          OR: [{ email: user.email }, { id: user.userId || -1 }],
        },
      });

      if (!calUser) {
        continue;
      }

      // Check calendar connections based on provider
      const integrationSlug = provider === "zoho" ? "zoho_calendar" : "office365_calendar";

      const selectedCalendars = await prisma.selectedCalendar.findMany({
        where: {
          userId: calUser.id,
          integration: integrationSlug,
        },
      });

      if (selectedCalendars.length === 0) {
        incompleteSetups.push({
          email: user.email,
          pendingTasks: [`User has not connected any ${providerName}`],
        });
        continue;
      }

      // Check free/busy settings for each calendar
      for (const calendar of selectedCalendars) {
        if (!calendar.credentialId) {
          pendingTasks.push(`User needs to reconnect ${providerName}`);
          continue;
        }

        const credential = await prisma.credential.findFirst({
          where: { id: calendar.credentialId },
          include: { user: true },
        });

        if (!credential) {
          pendingTasks.push(`User needs to reconnect ${providerName}`);
          continue;
        }

        // Provider-specific free/busy check
        try {
          if (provider === "zoho") {
            const zohoCalendarService = new ZohoCalendarService(credential);
            const calendars = await zohoCalendarService.listCalendarsRaw();
            const externalCalendar = calendars.calendars.find((cal: any) => cal.uid === calendar.externalId);

            if (!externalCalendar) {
              pendingTasks.push(`User needs to reconnect ${providerName}`);
              continue;
            }

            if (!externalCalendar.include_infreebusy) {
              pendingTasks.push(
                `User needs to enable free busy on ${providerName}: ${externalCalendar.name}`
              );
            }
          } else if (provider === "office365") {
            // Office365 handles free/busy differently
            // For Office365, we might just check if the calendar is properly connected
            try {
              const office365Service = new Office365CalendarService(credential);
              const calendars = await office365Service.listCalendars();
              const connectedCalendar = calendars.find((cal: any) => cal.externalId === calendar.externalId);

              if (!connectedCalendar) {
                pendingTasks.push(`User needs to reconnect ${providerName}`);
              }
              // Office365 typically shares free/busy by default in the same organization
            } catch (error) {
              pendingTasks.push(`User needs to reconnect ${providerName}`);
            }
          }
        } catch (error) {
          console.error(`Error checking ${provider} calendar:`, error);
          pendingTasks.push(`Error checking ${providerName} calendar settings`);
        }
      }

      if (pendingTasks.length) {
        incompleteSetups.push({
          email: user.email,
          pendingTasks,
        });
      }
    }
  }

  // Send notification if there are incomplete setups
  if (incompleteSetups.length) {
    if (process.env.ADMIN_EMAIL && process.env.ESA_MANAGED_EMAIL_SENDER_ADDRESS) {
      await sendMail({
        from: process.env.ESA_MANAGED_EMAIL_SENDER_ADDRESS,
        to: process.env.ADMIN_EMAIL,
        subject: "Reminder: Users with incomplete Cal setup",
        html: incompleteSetupReminderEmail(incompleteSetups),
      });
    }
  }

  console.log(`Processed setup for ${availableProviders.length} provider(s)`);

  return {
    message: "Incomplete setup check completed",
    providers: availableProviders,
    incompleteCount: incompleteSetups.length,
  };
}

export default defaultResponder(postHandler);
