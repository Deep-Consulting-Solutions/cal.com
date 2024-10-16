import type { NextApiRequest, NextApiResponse } from "next";
import * as crypto from "node:crypto";
import { stringify } from "querystring";

import { renewSelectedCalendarCredentialId } from "@calcom/lib/connectedCalendar";
import { WEBAPP_URL } from "@calcom/lib/constants";
import { getSafeRedirectUrl } from "@calcom/lib/getSafeRedirectUrl";
import logger from "@calcom/lib/logger";
import { defaultHandler, defaultResponder } from "@calcom/lib/server";
import prisma from "@calcom/prisma";
import { Prisma } from "@calcom/prisma/client";

import getAppKeysFromSlug from "../../_utils/getAppKeysFromSlug";
import getInstalledAppPath from "../../_utils/getInstalledAppPath";
import { decodeOAuthState } from "../../_utils/oauth/decodeOAuthState";
import type { IntegrationOAuthCallbackState } from "../../types";
import config from "../config.json";
import type { ZohoAuthCredentials } from "../types/ZohoCalendar";
import { appKeysSchema as zohoKeysSchema } from "../zod";

const log = logger.getSubLogger({ prefix: [`[[zohocalendar/api/callback]`] });

const OAUTH_BASE_URL = "https://accounts.zoho.com/oauth/v2";

async function getHandler(req: NextApiRequest, res: NextApiResponse) {
  const { code } = req.query;
  const state = decodeOAuthState(req) as
    | (IntegrationOAuthCallbackState & {
        fromManagedSetup?: boolean;
        userId?: number;
        managedSetupId?: number;
        managedSetupReturnTo?: string;
      })
    | undefined;

  const fromManagedSetup = !!state?.fromManagedSetup;
  const userId = state?.userId || req.session?.user?.id;

  if (code && typeof code !== "string") {
    res.status(400).json({ message: "`code` must be a string" });
    return;
  }

  if (!userId) {
    return res.status(401).json({ message: "You must be logged in to do this" });
  }

  const appKeys = await getAppKeysFromSlug(config.slug);
  const { client_id, client_secret } = zohoKeysSchema.parse(appKeys);

  const params = {
    client_id,
    grant_type: "authorization_code",
    client_secret,
    redirect_uri: `${WEBAPP_URL}/api/integrations/${config.slug}/callback`,
    code,
  };

  const query = stringify(params);

  const response = await fetch(`${OAUTH_BASE_URL}/token?${query}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });

  const responseBody = await response.json();

  if (!response.ok || responseBody.error) {
    log.error("get access_token failed", responseBody);
    return res.redirect(`/apps/installed?error=${JSON.stringify(responseBody)}`);
  }

  const key: ZohoAuthCredentials = {
    access_token: responseBody.access_token,
    refresh_token: responseBody.refresh_token,
    expires_in: Math.round(+new Date() / 1000 + responseBody.expires_in),
  };

  const calendarResponse = await fetch("https://calendar.zoho.com/api/v1/calendars", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${key.access_token}`,
      "Content-Type": "application/json",
    },
  });
  const data = await calendarResponse.json();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const primaryCalendar = data.calendars.find((calendar: any) => calendar.isdefault);
  const onlyOneCalendar = data.calendars.length === 1;

  const generateToken = (): Promise<string> =>
    new Promise((resolve) => crypto.randomBytes(48, (err, buffer) => resolve(buffer.toString("hex"))));

  const updateManagedSetupAndGetRedirectUrl = async () => {
    const setupCompleted = fromManagedSetup && onlyOneCalendar;
    const setupNotCompleted = fromManagedSetup && !onlyOneCalendar;
    const completeSetupToken = await generateToken();

    const updates: Record<string, string> = {
      ...(setupCompleted ? { status: "Completed" } : {}),
      ...(setupNotCompleted ? { completeSetupToken } : {}),
    };

    if (!!Object.keys(updates).length) {
      await prisma.zohoSchedulingSetup.update({
        where: {
          id: state?.managedSetupId as number,
        },
        data: {
          ...updates,
        },
      });
    }

    const query = {
      setupCompleted,
      completeSetupToken: setupNotCompleted ? completeSetupToken : undefined,
    };

    const redirectUrl = fromManagedSetup
      ? `${state?.managedSetupReturnTo || ""}?${stringify(query)}`
      : state?.returnTo;

    return { setupCompleted, redirectUrl };
  };

  if (primaryCalendar.uid) {
    const credential = await prisma.credential.create({
      data: {
        type: config.type,
        key,
        userId: userId,
        appId: config.slug,
      },
    });
    const selectedCalendarWhereUnique = {
      userId: userId,
      integration: config.type,
      externalId: primaryCalendar.uid,
    };
    // Wrapping in a try/catch to reduce chance of race conditions-
    // also this improves performance for most of the happy-paths.
    try {
      await prisma.selectedCalendar.create({
        data: {
          ...selectedCalendarWhereUnique,
          credentialId: credential.id,
        },
      });
    } catch (error) {
      let errorMessage = "something_went_wrong";
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        // it is possible a selectedCalendar was orphaned, in this situation-
        // we want to recover by connecting the existing selectedCalendar to the new Credential.
        if (await renewSelectedCalendarCredentialId(selectedCalendarWhereUnique, credential.id)) {
          const { redirectUrl } = await updateManagedSetupAndGetRedirectUrl();
          res.redirect(
            getSafeRedirectUrl(redirectUrl) ?? getInstalledAppPath({ variant: "calendar", slug: config.slug })
          );
          return;
        }
        // else
        errorMessage = "account_already_linked";
      }
      await prisma.credential.delete({ where: { id: credential.id } });
      res.redirect(
        `${
          getSafeRedirectUrl(state?.onErrorReturnTo) ??
          getInstalledAppPath({ variant: config.variant, slug: config.slug })
        }?error=${errorMessage}`
      );
      return;
    }
  }

  const { redirectUrl } = await updateManagedSetupAndGetRedirectUrl();

  res.redirect(
    getSafeRedirectUrl(redirectUrl) ?? getInstalledAppPath({ variant: config.variant, slug: config.slug })
  );
}

export default defaultHandler({
  GET: Promise.resolve({ default: defaultResponder(getHandler) }),
});
