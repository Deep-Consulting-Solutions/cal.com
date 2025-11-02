/* eslint-disable @typescript-eslint/no-explicit-any */
import type { NextApiRequest } from "next";

import { defaultResponder } from "@calcom/lib/server";
import prisma from "@calcom/prisma";

import type { CalendarProvider } from "../../services/providers";
import { ProviderFactory } from "../../services/providers";

interface ResendSetupEmailRequest {
  provider?: CalendarProvider;
  userId?: string;
  zuid?: string; // For backward compatibility with Zoho
}

export async function postHandler(req: NextApiRequest) {
  const body = req.body as ResendSetupEmailRequest;

  // Determine provider - default to zoho for backward compatibility
  let provider = (body.provider || "zoho") as CalendarProvider;
  let userId = body.userId || body.zuid || "";

  // If no provider specified and we have a zuid, assume it's Zoho
  if (!body.provider && body.zuid) {
    provider = "zoho";
    userId = body.zuid;
  }

  // Validate provider configuration
  const validation = ProviderFactory.validateProvider(provider);
  if (!validation.valid) {
    return {
      error: validation.error,
      message: validation.error,
    };
  }

  // Get provider service
  const providerService = ProviderFactory.getProvider(provider);

  try {
    // Look up the user's setup based on provider
    let userSetup: any;
    let userEmail: string;
    let userName: string;
    let calUserId: number;

    if (provider === "zoho") {
      // Look up in ZohoSchedulingSetup for backward compatibility
      userSetup = await prisma.zohoSchedulingSetup.findFirst({
        where: { zuid: userId },
        include: {
          user: true,
        },
      });

      if (!userSetup) {
        return {
          error: "User setup not found",
          message: "No Zoho setup found for this user",
        };
      }

      calUserId = userSetup.userId;
      userEmail = userSetup.user.email;
      userName = userSetup.user.name || userSetup.user.email;
    } else {
      // Look up in ManagedSchedulingSetup for other providers
      userSetup = await prisma.managedSchedulingSetup.findFirst({
        where: {
          OR: [{ externalId: userId }, { userId: parseInt(userId) || -1 }],
          provider,
        },
        include: {
          user: true,
        },
      });

      if (!userSetup) {
        return {
          error: "User setup not found",
          message: `No ${providerService.getDisplayName()} setup found for this user`,
        };
      }

      calUserId = userSetup.userId;
      userEmail = userSetup.user.email;
      userName = userSetup.user.name || userSetup.user.email;
    }

    // Check if setup is already completed
    if (userSetup.status === "Completed") {
      return {
        message: "Setup already completed",
        data: {
          status: "Completed",
        },
      };
    }

    // Generate OAuth URL using provider service
    const oauthUrl = await providerService.generateOAuthUrl(
      provider === "zoho" ? userId : calUserId.toString(),
      userSetup.id // Pass managedSetupId for state parameter
    );

    // Send setup email using generic function
    const { sendCalendarSetupEmail } = await import("../../lib/utils");
    console.log(`Resending setup email to ${userEmail}`);
    if (process.env.ESA_MANAGED_EMAIL_SENDER_ADDRESS) {
      await sendCalendarSetupEmail({
        to: userEmail,
        oauthUrl,
        userName,
        providerName: providerService.getDisplayName(),
      });
    }

    // Update status to Pending Completion if not already
    if (userSetup.status !== "Pending Completion") {
      if (provider === "zoho") {
        await prisma.zohoSchedulingSetup.update({
          where: { id: userSetup.id },
          data: { status: "Pending Completion" },
        });
      } else {
        await prisma.managedSchedulingSetup.update({
          where: { id: userSetup.id },
          data: { status: "Pending Completion" },
        });
      }
    }

    return {
      message: `${providerService.getDisplayName()} setup email sent successfully`,
      data: {
        status: "Email Sent",
        provider,
        oauthUrl,
      },
    };
  } catch (error: any) {
    console.error(`Error resending setup email for ${provider}:`, error);
    return {
      error: error.message || "Failed to resend setup email",
      message: error.message || "Failed to resend setup email",
    };
  }
}

export default defaultResponder(postHandler);
