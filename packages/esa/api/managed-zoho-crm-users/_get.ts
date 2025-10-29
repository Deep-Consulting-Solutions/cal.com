/* eslint-disable @typescript-eslint/no-explicit-any */
import type { NextApiRequest } from "next";
import { defaultResponder } from "@calcom/lib/server";
import { getHandler as genericGetHandler } from "../managed-calendar-users/_get";

/**
 * Backward compatibility wrapper for Zoho-specific endpoint
 * Delegates to the generic provider-aware endpoint with provider=zoho
 */
export async function getHandler(req: NextApiRequest) {
  // Force provider to zoho for this endpoint
  req.query.provider = "zoho";
  return genericGetHandler(req);
}

export default defaultResponder(getHandler);