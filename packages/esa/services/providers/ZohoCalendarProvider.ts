import getAppKeysFromSlug from "@calcom/app-store/_utils/getAppKeysFromSlug";
import { appKeysSchema as zohoKeysSchema } from "@calcom/app-store/zohocalendar/zod";
import { hashPassword } from "@calcom/features/auth/lib/hashPassword";
import prisma from "@calcom/prisma";

import { sendZohoCalendarSetupEmail } from "../../lib/utils";
import { zohoClient } from "../../lib/zoho";
import { BaseCalendarProvider } from "./BaseCalendarProvider";
import type {
  CalendarProviderConfig,
  CalendarProviderUser,
  CalendarProviderSchedule,
  ProviderSetupResult,
} from "./types";

export class ZohoCalendarProvider extends BaseCalendarProvider {
  constructor() {
    super("zoho");
  }

  protected loadConfiguration(): Partial<CalendarProviderConfig> {
    return {
      provider: "zoho",
      clientId: this.getRequiredEnvVar("ZOHO_CLIENT_ID"),
      clientSecret: this.getRequiredEnvVar("ZOHO_CLIENT_SECRET"),
      redirectUri: `${process.env.WEBAPP_URL}/api/integrations/zohocalendar/callback`,
      scopes: ["ZohoCalendar.calendar.ALL", "ZohoCalendar.event.ALL"],
    };
  }

  isConfigured(): boolean {
    return !!(
      this.config.clientId &&
      this.config.clientSecret &&
      process.env.ZOHO_REFRESH_TOKEN &&
      process.env.ZOHO_CRM_BASE_URL
    );
  }

  getConfigurationError(): string | null {
    const requiredEnvVars = [
      "ZOHO_CLIENT_ID",
      "ZOHO_CLIENT_SECRET",
      "ZOHO_REFRESH_TOKEN",
      "ZOHO_CRM_BASE_URL",
    ];

    const missing = requiredEnvVars.filter((varName) => !this.getRequiredEnvVar(varName));

    if (missing.length > 0) {
      return `Zoho Calendar not configured. Missing environment variables: ${missing.join(", ")}`;
    }

    return null;
  }

  async fetchUsers(): Promise<CalendarProviderUser[]> {
    const zohoUsers = await zohoClient().crm().getRecords("users");

    // Fetch Zoho Mail accounts if MANAGER_URL is configured
    let mailAccounts: string[] = [];
    if (process.env.MANAGER_URL) {
      try {
        const mailResponse = await fetch(`${process.env.MANAGER_URL}/api/mail-accounts`);
        if (mailResponse.ok) {
          const data = await mailResponse.json();
          mailAccounts = data.data?.mailAccounts?.map((acc: any) => acc.email) || [];
        }
      } catch {
        // Ignore mail fetch errors
      }
    }

    // Get existing managed setups
    const managedSetups = await prisma.zohoSchedulingSetup.findMany({
      include: {
        user: {
          include: {
            schedules: true,
          },
        },
      },
    });

    const setupMap = new Map(managedSetups.map((setup) => [setup.zuid, setup]));

    return (zohoUsers.users || []).map((zohoUser) => {
      const setup = setupMap.get(zohoUser.zuid);
      const hasZohoMail = mailAccounts.includes(zohoUser.email);

      return {
        id: zohoUser.zuid,
        email: zohoUser.email,
        name: zohoUser.name,
        timeZone: zohoUser.timeZone || "UTC",
        hasCalendar: hasZohoMail,
        status: setup?.status || "Not Started",
        userId: setup?.userId?.toString(),
        scheduleId: setup?.user?.schedules?.[0]?.id?.toString(),
        zoomUserId: setup?.zoomUserId || undefined,
      } as CalendarProviderUser;
    });
  }

  async createSetup(params: {
    userId: string;
    email: string;
    name: string;
    timeZone: string;
    schedule: CalendarProviderSchedule;
    zoomUserId?: string;
  }): Promise<ProviderSetupResult> {
    try {
      // Check for app keys first
      const appKeys = await getAppKeysFromSlug("zohocalendar");
      const parsedKeys = zohoKeysSchema.safeParse(appKeys);

      if (!parsedKeys.success) {
        return {
          success: false,
          error:
            "Zoho Calendar app not configured in Cal.com. Please configure the Zohocalendar app with valid credentials.",
        };
      }

      // Create or update Cal.com user
      const username = params.email.split("@")[0];
      const hashedPassword = await hashPassword(`${Math.random()}`);

      const user = await prisma.user.upsert({
        where: { email: params.email },
        create: {
          email: params.email,
          username,
          name: params.name,
          password: hashedPassword,
          emailVerified: new Date(),
          identityProvider: "CAL",
          timeZone: params.timeZone,
          completedOnboarding: true,
          locale: "en",
        },
        update: {
          name: params.name,
          timeZone: params.timeZone,
        },
      });

      // Create schedule
      const scheduleData = {
        name: `${params.name}'s Schedule`,
        timeZone: params.timeZone,
        availability: params.schedule.availability as any,
      };

      await prisma.schedule.create({
        data: {
          ...scheduleData,
          userId: user.id,
        },
      });

      // Handle Zoom integration if provided
      if (params.zoomUserId) {
        await this.setupZoomCredential(user.id, params.zoomUserId);
      }

      // Create ZohoSchedulingSetup entry
      await prisma.zohoSchedulingSetup.upsert({
        where: { zuid: params.userId },
        create: {
          zuid: params.userId,
          userId: user.id,
          status: "Pending Completion",
          zoomUserId: params.zoomUserId,
        },
        update: {
          userId: user.id,
          status: "Pending Completion",
          zoomUserId: params.zoomUserId,
        },
      });

      // Generate OAuth URL
      const oauthUrl = await this.generateOAuthUrl(params.userId);

      // Send setup email
      await sendZohoCalendarSetupEmail({
        to: params.email,
        oauthUrl,
        userName: params.name,
      });

      return {
        success: true,
        oauthUrl,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Failed to create Zoho setup",
      };
    }
  }

  async updateSetup(params: {
    userId: string;
    schedule?: CalendarProviderSchedule;
    zoomUserId?: string;
    calendars?: Array<{
      externalId: string;
      credentialId: number;
      selected: boolean;
    }>;
  }): Promise<ProviderSetupResult> {
    try {
      const setup = await prisma.zohoSchedulingSetup.findUnique({
        where: { zuid: params.userId },
        include: { user: true },
      });

      if (!setup) {
        return {
          success: false,
          error: "Setup not found",
        };
      }

      // Update schedule if provided
      if (params.schedule) {
        await prisma.schedule.updateMany({
          where: { userId: setup.userId },
          data: {
            name: params.schedule.name,
            timeZone: params.schedule.timeZone,
            availability: params.schedule.availability as any,
          },
        });
      }

      // Update Zoom if provided
      if (params.zoomUserId) {
        await this.setupZoomCredential(setup.userId, params.zoomUserId);
      }

      // Update selected calendars if provided
      if (params.calendars) {
        for (const calendar of params.calendars) {
          if (calendar.selected) {
            await prisma.selectedCalendar.upsert({
              where: {
                userId_integration_externalId: {
                  userId: setup.userId,
                  integration: "zoho_calendar",
                  externalId: calendar.externalId,
                },
              },
              create: {
                userId: setup.userId,
                integration: "zoho_calendar",
                externalId: calendar.externalId,
                credentialId: calendar.credentialId,
              },
              update: {
                credentialId: calendar.credentialId,
              },
            });
          } else {
            await prisma.selectedCalendar.deleteMany({
              where: {
                userId: setup.userId,
                integration: "zoho_calendar",
                externalId: calendar.externalId,
              },
            });
          }
        }
      }

      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Failed to update Zoho setup",
      };
    }
  }

  async generateOAuthUrl(userId: string): Promise<string> {
    const appKeys = await getAppKeysFromSlug("zohocalendar");
    const { client_id } = zohoKeysSchema.parse(appKeys);

    const params = new URLSearchParams({
      scope: (this.config.scopes || []).join(" "),
      client_id,
      response_type: "code",
      redirect_uri: this.config.redirectUri || "",
      access_type: "offline",
      state: userId, // Pass zuid as state for callback
    });

    return `https://accounts.zoho.com/oauth/v2/auth?${params.toString()}`;
  }

  getAppSlug(): string {
    return "zohocalendar";
  }

  getDisplayName(): string {
    return "Zoho Calendar";
  }

  private async setupZoomCredential(userId: number, zoomUserId: string): Promise<void> {
    // Implementation would depend on your Zoom integration setup
    // This is a placeholder
    await prisma.credential.upsert({
      where: {
        userId_appId_type: {
          userId,
          appId: "zoom",
          type: "zoom_video",
        },
      },
      create: {
        userId,
        type: "zoom_video",
        appId: "zoom",
        key: { zoomUserId },
      },
      update: {
        key: { zoomUserId },
      },
    });
  }
}
