/* eslint-disable @typescript-eslint/no-explicit-any */
import type { NextApiRequest } from "next";
import { defaultResponder } from "@calcom/lib/server";
import { patchHandler as genericPatchHandler } from "../managed-calendar-users/_patch";

/**
 * Backward compatibility wrapper for Zoho-specific endpoint
 * Delegates to the generic provider-aware endpoint with provider=zoho
 */
export async function patchHandler(req: NextApiRequest) {
  // Force provider to zoho for this endpoint
  req.body.provider = "zoho";
  return genericPatchHandler(req);
}

export default defaultResponder(patchHandler);