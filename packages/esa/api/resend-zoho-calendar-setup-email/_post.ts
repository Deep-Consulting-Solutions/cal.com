/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PrismaClient } from "@prisma/client";
import type { NextApiRequest } from "next";
import { stringify } from "querystring";

import getAppKeysFromSlug from "@calcom/app-store/_utils/getAppKeysFromSlug";
import { WEBAPP_URL } from "@calcom/lib/constants";
import { defaultResponder } from "@calcom/lib/server";
import { appKeysSchema as zohoKeysSchema } from "@calcom/zohocalendar/zod";

import { sendMail } from "../../lib/mailer";
import setupZohoCalenderOauthEmail from "../../lib/mailer/templates/setupZohoCalenderOauthEmail";

async function postHandler(req: NextApiRequest) {
  const $req = req as NextApiRequest & { prisma: any };

  const { zuid } = $req.body;
  const prisma: PrismaClient = $req.prisma;

  if (!zuid) {
    throw new Error("zoho user id is required");
  }

  const existingSetupEntry = await prisma.zohoSchedulingSetup.findFirst({
    where: {
      zuid: zuid,
    },
  });
  if (!existingSetupEntry || !existingSetupEntry.userId) {
    throw new Error("zoho user managed setup has not started");
  }

  if (existingSetupEntry.status !== "Pending Completion") {
    throw new Error("zoho user managed setup is not pending completion");
  }

  const user = await prisma.user.findUnique({
    where: {
      id: Number(existingSetupEntry.userId),
    },
  });
  if (!user) {
    throw new Error("cal user not found");
  }

  // send zoho calendar oauth link
  const OAUTH_BASE_URL = "https://accounts.zoho.com/oauth/v2";

  const appKeys = await getAppKeysFromSlug("zohocalendar");

  const { client_id } = zohoKeysSchema.parse(appKeys);

  const state = JSON.stringify({
    managedSetupReturnTo: `${WEBAPP_URL}/esa/complete-setup`,
    onErrorReturnTo: `${WEBAPP_URL}/esa/complete-setup`,
    fromManagedSetup: true,
    managedSetupId: existingSetupEntry.id,
    userId: user.id,
  });

  const params = {
    client_id,
    response_type: "code",
    redirect_uri: `${WEBAPP_URL}/api/integrations/zohocalendar/callback`,
    scope: [
      "ZohoCalendar.calendar.ALL",
      "ZohoCalendar.event.ALL",
      "ZohoCalendar.freebusy.READ",
      "AaaServer.profile.READ",
    ],
    access_type: "offline",
    state,
    prompt: "consent",
  };

  const query = stringify(params);

  const url = `${OAUTH_BASE_URL}/auth?${query}`;

  if (process.env.ESA_MANAGED_EMAIL_SENDER_ADDRESS) {
    await sendMail({
      from: process.env.ESA_MANAGED_EMAIL_SENDER_ADDRESS,
      to: user.email,
      subject: "URGENT - Complete Your Scheduling Setup",
      html: setupZohoCalenderOauthEmail({ url }),
    });
  }

  return {
    message: "Zoho Calendar connection email sent",
  };
}

export default defaultResponder(postHandler);
