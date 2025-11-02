/* eslint-disable @typescript-eslint/no-explicit-any */
import type { NextApiRequest } from "next";

import { defaultResponder } from "@calcom/lib/server";

import { postHandler as genericPostHandler } from "../resend-calendar-setup-email/_post";

/**
 * Backward compatibility wrapper for Zoho-specific resend endpoint
 * Delegates to the generic provider-aware endpoint with provider=zoho
 */
export async function postHandler(req: NextApiRequest) {
  // Force provider to zoho for this endpoint
  req.body.provider = "zoho";

  // The generic handler expects either userId or zuid
  // This endpoint traditionally only receives zuid
  if (req.body.zuid && !req.body.userId) {
    req.body.userId = req.body.zuid;
  }

  return genericPostHandler(req);
}

export default defaultResponder(postHandler);
