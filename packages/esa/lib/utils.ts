import { sendMail } from "@calcom/emails";
import { setupCalendarOauthEmail } from "../emails/setupCalendarOauthEmail";

interface SendCalendarSetupEmailParams {
  to: string;
  oauthUrl: string;
  userName: string;
  providerName?: string;
}

export async function sendCalendarSetupEmail({
  to,
  oauthUrl,
  userName,
  providerName = "Calendar",
}: SendCalendarSetupEmailParams) {
  if (!process.env.ESA_MANAGED_EMAIL_SENDER_ADDRESS) {
    console.warn("ESA_MANAGED_EMAIL_SENDER_ADDRESS not configured - skipping email");
    return;
  }

  await sendMail({
    from: process.env.ESA_MANAGED_EMAIL_SENDER_ADDRESS,
    to,
    subject: `URGENT - Complete Your ${providerName} Setup`,
    html: setupCalendarOauthEmail({
      url: oauthUrl,
      userName,
      providerName,
    }),
  });
}

// For backward compatibility
export async function sendZohoCalendarSetupEmail(params: Omit<SendCalendarSetupEmailParams, "providerName">) {
  return sendCalendarSetupEmail({
    ...params,
    providerName: "Zoho Calendar",
  });
}