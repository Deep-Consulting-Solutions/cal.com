/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PrismaClient } from "@prisma/client";
import type { NextApiRequest } from "next";

import logger from "@calcom/lib/logger";
import { defaultResponder } from "@calcom/lib/server";
import { VideoApiAdapter } from "@calcom/zoomvideo/lib";

const log = logger.getSubLogger({ prefix: ["[esa/api/zoom-users]"] });

type ZoomUser = {
  id: string;
  first_name: string;
  last_name: string;
  display_name: string;
  email: string;
  status: string;
};

async function getHandler(req: NextApiRequest) {
  const $req = req as NextApiRequest & { prisma: any };
  const { excludeZohoUserId } = $req.query;

  log.debug(`Fetching Zoom users for managed setup`, {
    excludeZohoUserId,
  });

  // Using server-to-server auth by providing user_id: true
  const adapter = VideoApiAdapter({ key: { user_id: true } } as any);

  let response;
  try {
    response = await (adapter as any).getZoomUsers();
    log.debug(`Zoom users fetched`, {
      totalUsers: response?.users?.length || 0,
    });
  } catch (error) {
    log.error(`Failed to fetch Zoom users`, {
      error: error instanceof Error ? error.message : "Unknown error",
      errorType: error?.constructor?.name,
    });
    throw error;
  }

  const prisma: PrismaClient = $req.prisma;
  const schedulingSetupEntries = await prisma.zohoSchedulingSetup.findMany();

  log.debug(`Found scheduling setup entries`, {
    totalEntries: schedulingSetupEntries.length,
  });

  const linkedZoomAccounts = schedulingSetupEntries
    .filter((entry) => {
      return excludeZohoUserId ? entry.zuid !== excludeZohoUserId : true;
    })
    .map((entry) => entry.zoomUserId);

  log.debug(`Linked Zoom accounts`, {
    linkedCount: linkedZoomAccounts.length,
    excludingZohoUser: !!excludeZohoUserId,
  });

  const notYetLinkedZoomUsers = (response.users as ZoomUser[])
    .filter((user) => {
      return !linkedZoomAccounts.includes(user.id);
    })
    .map((user) => {
      return {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
      };
    });

  log.debug(`Returning unlinked Zoom users`, {
    unlinkedCount: notYetLinkedZoomUsers.length,
    totalAvailable: response?.users?.length || 0,
    alreadyLinked: linkedZoomAccounts.length,
  });

  return {
    zoomUsers: notYetLinkedZoomUsers,
  };
}

export default defaultResponder(getHandler);
