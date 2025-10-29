/* eslint-disable @typescript-eslint/no-explicit-any */
import type { NextApiRequest } from "next";
import { defaultResponder } from "@calcom/lib/server";
import { postHandler as genericPostHandler } from "../managed-calendar-users/_post";

/**
 * Backward compatibility wrapper for Zoho-specific endpoint
 * Delegates to the generic provider-aware endpoint with provider=zoho
 */
export async function postHandler(req: NextApiRequest) {
  // Force provider to zoho for this endpoint
  req.body.provider = "zoho";
  return genericPostHandler(req);
}

export default defaultResponder(postHandler);