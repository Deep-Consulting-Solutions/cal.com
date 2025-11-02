/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PrismaClient } from "@prisma/client";
import type { NextApiRequest } from "next";

import { defaultResponder } from "@calcom/lib/server";
import Office365CalendarService from "@calcom/office365calendar/lib/CalendarService";
import ZohoCalendarService from "@calcom/zohocalendar/lib/CalendarService";

import { sendMail } from "../../lib/mailer";
import setupFreeBusyZohoCalendarReminderEmail from "../../lib/mailer/templates/setupFreeBusyZohoCalendarReminderEmail";
import { ProviderFactory } from "../../services/providers";

async function postHandler(req: NextApiRequest) {
  const $req = req as NextApiRequest & { prisma: any };
  const prisma: PrismaClient = $req.prisma;

  const selectedCalendars = await prisma.selectedCalendar.findMany();
  const credentials = await prisma.credential.findMany({ include: { user: true } });

  console.log(`Processing ${selectedCalendars.length} calendars`);

  // Get available providers
  const availableProviders = ProviderFactory.getAvailableProviders();

  for (const provider of availableProviders) {
    const providerService = ProviderFactory.getProvider(provider);
    const providerName = providerService.getDisplayName();

    // Filter calendars for this provider
    const integrationSlug = provider === "zoho" ? "zoho_calendar" : "office365_calendar";
    const providerCalendars = selectedCalendars.filter((cal) => cal.integration === integrationSlug);

    console.log(`Processing ${providerCalendars.length} ${providerName} calendars`);

    for (const calendar of providerCalendars) {
      const credential = credentials.find((credential) => {
        return credential.id.toString() === calendar.credentialId?.toString();
      });

      if (!credential) {
        console.log(`Skipping calendar with external id ${calendar.externalId}: credential not found`);
        continue;
      }

      try {
        if (provider === "zoho") {
          // Zoho-specific free/busy check
          const zohoCalendarService = new ZohoCalendarService(credential);
          const calendars = await zohoCalendarService.listCalendarsRaw();

          const externalCalendar = calendars.calendars.find((cal: any) => {
            return cal.uid === calendar.externalId;
          });

          if (!externalCalendar) {
            console.log(
              `Skipping calendar with external id ${calendar.externalId}: calendar not found on Zoho`
            );
            continue;
          }

          const isSharingFreeBusy = !!externalCalendar.include_infreebusy;

          if (isSharingFreeBusy) {
            console.log(
              `Skipping calendar with external id ${calendar.externalId}: already sharing free busy`
            );
            continue;
          }

          // Send notification to user for Zoho
          if (credential.user?.email && process.env.ESA_MANAGED_EMAIL_SENDER_ADDRESS) {
            await sendMail({
              from: process.env.ESA_MANAGED_EMAIL_SENDER_ADDRESS,
              to: credential.user.email,
              subject: `Reminder: Complete your ${providerName} setup for Cal bookings`,
              html: setupFreeBusyZohoCalendarReminderEmail({
                calendarName: externalCalendar.name,
              }),
            });
          }
        } else if (provider === "office365") {
          // Office365-specific check
          // Office365 typically shares free/busy by default within the same organization
          // We might just verify the calendar is connected
          try {
            const office365Service = new Office365CalendarService(credential);
            const calendars = await office365Service.listCalendars();

            const externalCalendar = calendars.find((cal: any) => {
              return cal.externalId === calendar.externalId;
            });

            if (!externalCalendar) {
              console.log(
                `Skipping calendar with external id ${calendar.externalId}: calendar not found on Office365`
              );

              // Send reconnection reminder
              if (credential.user?.email && process.env.ESA_MANAGED_EMAIL_SENDER_ADDRESS) {
                await sendMail({
                  from: process.env.ESA_MANAGED_EMAIL_SENDER_ADDRESS,
                  to: credential.user.email,
                  subject: `Reminder: Reconnect your ${providerName} for Cal bookings`,
                  html: `
                    <p>Hello,</p>
                    <p>We noticed that your ${providerName} calendar connection needs to be refreshed.</p>
                    <p>Please log in to your Cal.com account and reconnect your ${providerName} to ensure your bookings continue to work properly.</p>
                    <p>Thank you!</p>
                  `,
                });
              }
              continue;
            }

            // Office365 calendars typically share free/busy automatically
            // No specific action needed unless calendar is disconnected
            console.log(`Calendar ${calendar.externalId} on Office365 is properly connected`);
          } catch (error) {
            console.error(`Error checking Office365 calendar ${calendar.externalId}:`, error);
          }
        }
      } catch (error) {
        console.error(`Error processing ${provider} calendar ${calendar.externalId}:`, error);
      }
    }
  }

  console.log(`Done processing calendars for ${availableProviders.length} provider(s)`);

  return {
    message: "Free/busy check completed",
    providers: availableProviders,
  };
}

export default defaultResponder(postHandler);
