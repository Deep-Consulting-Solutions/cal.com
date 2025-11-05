import type { NextApiRequest } from "next";
import { stringify } from "querystring";

import { WEBAPP_URL } from "@calcom/lib/constants";
import logger from "@calcom/lib/logger";
import { defaultHandler, defaultResponder } from "@calcom/lib/server";
import prisma from "@calcom/prisma";

import { encodeOAuthState } from "../../_utils/oauth/encodeOAuthState";
import { getZoomAppKeys } from "../lib";

const log = logger.getSubLogger({ prefix: ["[zoomvideo/api/add]"] });

async function handler(req: NextApiRequest) {
  const userId = req.session?.user?.id;

  log.debug(`Zoom OAuth flow initiated`, {
    userId,
    hasSession: !!req.session,
  });

  // Get user
  await prisma.user.findFirstOrThrow({
    where: {
      id: userId,
    },
    select: {
      id: true,
    },
  });

  const { client_id } = await getZoomAppKeys();
  const state = encodeOAuthState(req);

  const params = {
    response_type: "code",
    client_id,
    redirect_uri: `${WEBAPP_URL}/api/integrations/zoomvideo/callback`,
    state,
  };

  log.debug(`Redirecting to Zoom OAuth`, {
    userId,
    redirectUri: params.redirect_uri,
    hasClientId: !!client_id,
  });

  const query = stringify(params);
  const url = `https://zoom.us/oauth/authorize?${query}`;

  log.silly(`Zoom OAuth URL generated`, {
    userId,
    authEndpoint: "https://zoom.us/oauth/authorize",
  });

  return { url };
}

export default defaultHandler({
  GET: Promise.resolve({ default: defaultResponder(handler) }),
});
