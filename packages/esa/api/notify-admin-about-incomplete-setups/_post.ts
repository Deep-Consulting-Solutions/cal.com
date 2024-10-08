/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PrismaClient } from "@prisma/client";
import type { NextApiRequest } from "next";

import { defaultResponder } from "@calcom/lib/server";
import ZohoCalendarService from "@calcom/zohocalendar/lib/CalendarService";

import { sendMail } from "../../lib/mailer";
import incompleteSetupReminderEmail from "../../lib/mailer/templates/incompleteSetupReminderEmail";
import { getHandler as getManagedCrmUsers } from "../managed-zoho-crm-users/_get";

async function postHandler(req: NextApiRequest) {
  const $req = req as NextApiRequest & { prisma: any };
  const prisma: PrismaClient = $req.prisma;

  const incompleteSetups: { email: string; pendingTasks: string[] }[] = [];

  const { crmUsers } = await getManagedCrmUsers(req);
  for (const crmUser of crmUsers) {
    const hasNotStartedSetup = crmUser.status === "Not Started";
    if (hasNotStartedSetup) {
      incompleteSetups.push({
        email: crmUser.email,
        pendingTasks: ["Managed setup has not been done"],
      });
      continue;
    }

    // check if user has setup zoho calendar
    const user = await prisma.user.findFirst({
      where: {
        email: crmUser.email,
      },
    });
    if (!user) {
      incompleteSetups.push({
        email: crmUser.email,
        pendingTasks: ["Managed setup has not been done"],
      });
      continue;
    }

    const selectedCalendars = await prisma.selectedCalendar.findMany({
      where: {
        userId: user.id,
        integration: "zoho_calendar",
      },
    });
    if (selectedCalendars.length === 0) {
      incompleteSetups.push({
        email: crmUser.email,
        pendingTasks: ["User has not connected any zoho calendar"],
      });
      continue;
    }

    const pendingTasks: string[] = [];

    // check if free busy is enabled for all calendars
    for (const calendar of selectedCalendars) {
      if (!calendar.credentialId) {
        pendingTasks.push("User needs to reconnect zoho calendar");
        continue;
      }

      const credential = await prisma.credential.findFirst({
        where: { id: calendar.credentialId },
        include: { user: true },
      });
      if (!credential) {
        pendingTasks.push("User needs to reconnect zoho calendar");
        continue;
      }

      const zohoCalendarService = new ZohoCalendarService(credential);
      const calendars = await zohoCalendarService.listCalendarsRaw();

      const externalCalendar = calendars.calendars.find((cal) => {
        return cal.uid === calendar.externalId;
      });

      if (!externalCalendar) {
        pendingTasks.push("User needs to reconnect zoho calendar");
        continue;
      }

      const isSharingFreeBusy = !!externalCalendar.include_infreebusy;
      if (!isSharingFreeBusy) {
        pendingTasks.push(`User needs to enable free busy on zoho calendar: ${externalCalendar.name}`);
      }
    }

    if (pendingTasks.length) {
      incompleteSetups.push({
        email: crmUser.email,
        pendingTasks,
      });
      continue;
    }
  }

  if (incompleteSetups.length) {
    // send notification to admin
    if (process.env.ADMIN_EMAIL) {
      await sendMail({
        from: "buffer-sender@buffer-staging.esa-emails.technology", // TODO: get from env
        to: process.env.ADMIN_EMAIL,
        subject: "Reminder: Users with incomplete Cal setup",
        html: incompleteSetupReminderEmail(incompleteSetups),
      });
    }
  }

  console.log(`done processing setup crm users`);

  return {
    message: "In progress",
  };
}

export default defaultResponder(postHandler);
