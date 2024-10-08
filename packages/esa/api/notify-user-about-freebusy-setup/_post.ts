/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PrismaClient } from "@prisma/client";
import type { NextApiRequest } from "next";

import { defaultResponder } from "@calcom/lib/server";
import ZohoCalendarService from "@calcom/zohocalendar/lib/CalendarService";

import { sendMail } from "../../lib/mailer";
import setupFreeBusyZohoCalendarReminderEmail from "../../lib/mailer/templates/setupFreeBusyZohoCalendarReminderEmail";

async function postHandler(req: NextApiRequest) {
  const $req = req as NextApiRequest & { prisma: any };
  const prisma: PrismaClient = $req.prisma;

  const selectedCalendars = await prisma.selectedCalendar.findMany();
  const credentials = await prisma.credential.findMany({ include: { user: true } });

  const zohoCalendars = selectedCalendars.filter((cal) => cal.integration === "zoho_calendar");
  console.log(`processing ${selectedCalendars.length} calendars`);

  for (const calendar of zohoCalendars) {
    const credential = credentials.find((credential) => {
      return credential.id.toString() === calendar.credentialId?.toString();
    });

    if (!credential) {
      console.log(`skipping calendar with external id ${calendar.externalId}: credential not found`);
      continue;
    }

    //
    const zohoCalendarService = new ZohoCalendarService(credential);
    const calendars = await zohoCalendarService.listCalendarsRaw();

    const externalCalendar = calendars.calendars.find((cal) => {
      return cal.uid === calendar.externalId;
    });

    if (!externalCalendar) {
      console.log(`skipping calendar with external id ${calendar.externalId}: calendar not found on zoho`);
      continue;
    }

    const isSharingFreeBusy = !!externalCalendar.include_infreebusy;

    if (isSharingFreeBusy) {
      console.log(
        `skipping calendar with external id ${calendar.externalId}: sharing free busy for this calendar already`
      );
      continue;
    }

    // send notification to user
    if (credential.user?.email) {
      await sendMail({
        from: "buffer-sender@buffer-staging.esa-emails.technology", // TODO: get from env
        to: credential.user?.email,
        subject: "Reminder: Complete your zoho calender setup for Cal bookings",
        html: setupFreeBusyZohoCalendarReminderEmail({ calendarName: externalCalendar.name }),
      });
    }
  }

  console.log(`done processing ${credentials.length} credentials`);

  return {
    message: "In progress",
  };
}

export default defaultResponder(postHandler);
