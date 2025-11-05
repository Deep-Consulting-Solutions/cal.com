import type { NextApiRequest, NextApiResponse } from "next";

import { WEBAPP_URL } from "@calcom/lib/constants";
import logger from "@calcom/lib/logger";
import prisma from "@calcom/prisma";

import getInstalledAppPath from "../../_utils/getInstalledAppPath";
import createOAuthAppCredential from "../../_utils/oauth/createOAuthAppCredential";
import { getZoomAppKeys } from "../lib";

const log = logger.getSubLogger({ prefix: ["[zoomvideo/api/callback]"] });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { code } = req.query;
  const userId = req.session?.user?.id;

  log.debug(`Zoom OAuth callback initiated`, {
    hasCode: !!code,
    userId,
    codeLength: typeof code === "string" ? code.length : 0,
  });

  const { client_id, client_secret } = await getZoomAppKeys();

  const redirectUri = encodeURI(`${WEBAPP_URL}/api/integrations/zoomvideo/callback`);
  const authHeader = `Basic ${Buffer.from(`${client_id}:${client_secret}`).toString("base64")}`;

  log.debug(`Exchanging Zoom authorization code for token`, {
    userId,
    redirectUri,
  });

  const result = await fetch(
    `https://zoom.us/oauth/token?grant_type=authorization_code&code=${code}&redirect_uri=${redirectUri}`,
    {
      method: "POST",
      headers: {
        Authorization: authHeader,
      },
    }
  );

  log.debug(`Zoom token exchange response`, {
    userId,
    status: result.status,
    statusText: result.statusText,
  });

  if (result.status !== 200) {
    let errorMessage = "Something is wrong with Zoom API";
    try {
      const responseBody = await result.json();
      errorMessage = responseBody.error;
      log.error(`Zoom OAuth token exchange failed`, {
        userId,
        status: result.status,
        error: responseBody.error,
        reason: responseBody.reason,
        errorDescription: responseBody.error_description,
      });
    } catch (e) {
      log.error(`Failed to parse Zoom error response`, {
        userId,
        status: result.status,
        parseError: e instanceof Error ? e.message : "Unknown error",
      });
    }

    res.status(400).json({ message: errorMessage });
    return;
  }

  const responseBody = await result.json();

  if (responseBody.error) {
    log.error(`Zoom OAuth response contains error`, {
      userId,
      error: responseBody.error,
      errorDescription: responseBody.error_description,
    });
    res.status(400).json({ message: responseBody.error });
    return;
  }

  log.debug(`Zoom OAuth token received successfully`, {
    userId,
    scope: responseBody.scope,
    tokenType: responseBody.token_type,
    expiresIn: responseBody.expires_in,
  });

  responseBody.expiry_date = Math.round(Date.now() + responseBody.expires_in * 1000);
  delete responseBody.expires_in;

  if (!userId) {
    log.error(`No user found in session for Zoom OAuth callback`);
    return res.status(404).json({ message: "No user found" });
  }
  /**
   * With this we take care of no duplicate zoom_video key for a single user
   * when creating a video room we only do findFirst so the if they have more than 1
   * others get ignored
   * */
  log.debug(`Checking for existing Zoom credentials`, { userId });

  const existingCredentialZoomVideo = await prisma.credential.findMany({
    select: {
      id: true,
    },
    where: {
      type: "zoom_video",
      userId: req.session?.user.id,
      appId: "zoom",
    },
  });

  // Making sure we only delete zoom_video
  const credentialIdsToDelete = existingCredentialZoomVideo.map((item) => item.id);
  if (credentialIdsToDelete.length > 0) {
    log.debug(`Deleting existing Zoom credentials`, {
      userId,
      credentialCount: credentialIdsToDelete.length,
      credentialIds: credentialIdsToDelete,
    });
    await prisma.credential.deleteMany({ where: { id: { in: credentialIdsToDelete }, userId } });
  }

  log.debug(`Creating new Zoom OAuth credential`, {
    userId,
    appId: "zoom",
    type: "zoom_video",
  });

  await createOAuthAppCredential({ appId: "zoom", type: "zoom_video" }, responseBody, req);

  log.debug(`Zoom OAuth setup completed successfully`, { userId });

  res.redirect(getInstalledAppPath({ variant: "conferencing", slug: "zoom" }));
}
