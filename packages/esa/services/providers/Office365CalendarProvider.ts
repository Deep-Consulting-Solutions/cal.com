import getAppKeysFromSlug from "@calcom/app-store/_utils/getAppKeysFromSlug";
import { hashPassword } from "@calcom/features/auth/lib/hashPassword";
import prisma from "@calcom/prisma";

import { sendCalendarSetupEmail } from "../../lib/utils";
import { BaseCalendarProvider } from "./BaseCalendarProvider";
import type {
  CalendarProviderConfig,
  CalendarProviderUser,
  CalendarProviderSchedule,
  ProviderSetupResult,
} from "./types";

interface Office365Keys {
  client_id: string;
  client_secret: string;
  tenant_id?: string;
}

export class Office365CalendarProvider extends BaseCalendarProvider {
  constructor() {
    super("office365");
  }

  protected loadConfiguration(): Partial<CalendarProviderConfig> {
    return {
      provider: "office365",
      clientId: this.getRequiredEnvVar("MICROSOFT_CLIENT_ID"),
      clientSecret: this.getRequiredEnvVar("MICROSOFT_CLIENT_SECRET"),
      redirectUri: `${process.env.WEBAPP_URL}/api/integrations/office365calendar/callback`,
      scopes: ["User.Read", "Calendars.ReadWrite", "offline_access"],
    };
  }

  isConfigured(): boolean {
    // Check if Office365 calendar app is configured in Cal.com
    return !!(this.config.clientId && this.config.clientSecret);
  }

  getConfigurationError(): string | null {
    // First check environment variables
    if (!this.config.clientId || !this.config.clientSecret) {
      return "Microsoft Outlook Calendar not configured. Missing MICROSOFT_CLIENT_ID or MICROSOFT_CLIENT_SECRET environment variables.";
    }

    return null;
  }

  async fetchUsers(): Promise<CalendarProviderUser[]> {
    // Fetch users from Zoho CRM (same user pool as Zoho provider)
    // These are the staff members who can be set up with Office365 calendar
    const { zohoClient } = await import("../../lib/zoho");
    const zohoUsers = await zohoClient().crm().getRecords("users");

    // Get existing Office365 managed setups from database
    const managedSetups = await prisma.managedSchedulingSetup.findMany({
      where: { provider: "office365" },
      include: {
        user: {
          include: {
            schedules: true,
            credentials: {
              where: { appId: "office365-calendar" },
            },
          },
        },
      },
    });

    // Create a map of existing setups by zuid for quick lookup
    const setupMap = new Map(managedSetups.map((setup) => [setup.externalId, setup]));

    // Map Zoho CRM users and merge with Office365 setup status
    return (zohoUsers.users || []).map((zohoUser: any) => {
      const setup = setupMap.get(zohoUser.zuid);

      return {
        id: zohoUser.zuid,
        email: zohoUser.email,
        name: zohoUser.name,
        timeZone: zohoUser.timeZone || "UTC",
        hasCalendar: setup ? setup.user.credentials.length > 0 : false,
        status: (setup?.status || "Not Started") as any,
        userId: setup?.userId?.toString(),
        scheduleId: setup?.user?.schedules?.[0]?.id?.toString(),
        zoomUserId: setup?.zoomUserId || undefined,
      };
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
      const appKeys = await getAppKeysFromSlug("office365-calendar");

      if (!appKeys || !appKeys.client_id || !appKeys.client_secret) {
        return {
          success: false,
          error:
            "Microsoft Outlook Calendar app not configured in Cal.com. Please configure the Office365calendar app with valid credentials.",
        };
      }

      // Create or update Cal.com user
      const username = params.email.split("@")[0];

      const user = await prisma.user.upsert({
        where: { email: params.email },
        create: {
          email: params.email,
          username,
          name: params.name,
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

      // Create password separately if user is new
      const existingPassword = await prisma.userPassword.findUnique({
        where: { userId: user.id },
      });

      if (!existingPassword) {
        const hashedPassword = await hashPassword(`${Math.random()}`);
        await prisma.userPassword.create({
          data: {
            userId: user.id,
            hash: hashedPassword,
          },
        });
      }

      // Create schedule with availability records
      const { getAvailabilityFromSchedule } = await import("@calcom/lib/availability");
      const availabilityData = getAvailabilityFromSchedule(params.schedule.availability);

      await prisma.schedule.create({
        data: {
          name: `${params.name}'s Schedule`,
          timeZone: params.timeZone,
          userId: user.id,
          availability: {
            createMany: {
              data: availabilityData.map((schedule) => ({
                days: schedule.days,
                startTime: schedule.startTime,
                endTime: schedule.endTime,
              })),
            },
          },
        },
      });

      // Handle Zoom integration if provided
      if (params.zoomUserId) {
        await this.setupZoomCredential(user.id, params.zoomUserId);
      }

      // Create ManagedSchedulingSetup entry
      await prisma.managedSchedulingSetup.upsert({
        where: {
          userId_provider: {
            userId: user.id,
            provider: "office365",
          },
        },
        create: {
          userId: user.id,
          provider: "office365",
          externalId: params.userId,
          status: "Pending Completion",
          zoomUserId: params.zoomUserId,
        },
        update: {
          status: "Pending Completion",
          zoomUserId: params.zoomUserId,
        },
      });

      // Generate OAuth URL
      const oauthUrl = await this.generateOAuthUrl(user.id.toString());

      // Send setup email
      await sendCalendarSetupEmail({
        to: params.email,
        oauthUrl,
        userName: params.name,
        providerName: "Microsoft Outlook",
      });

      return {
        success: true,
        oauthUrl,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Failed to create Microsoft Outlook setup",
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
      const userIdNum = parseInt(params.userId);

      const setup = await prisma.managedSchedulingSetup.findUnique({
        where: {
          userId_provider: {
            userId: userIdNum,
            provider: "office365",
          },
        },
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
                  integration: "office365_calendar",
                  externalId: calendar.externalId,
                },
              },
              create: {
                userId: setup.userId,
                integration: "office365_calendar",
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
                integration: "office365_calendar",
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
        error: error.message || "Failed to update Microsoft Outlook setup",
      };
    }
  }

  async generateOAuthUrl(userId: string): Promise<string> {
    const appKeys = (await getAppKeysFromSlug("office365-calendar")) as Office365Keys;

    const tenantId = appKeys.tenant_id || "common";
    const params = new URLSearchParams({
      client_id: appKeys.client_id,
      response_type: "code",
      redirect_uri: this.config.redirectUri || "",
      response_mode: "query",
      scope: (this.config.scopes || []).join(" "),
      state: userId,
    });

    return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
  }

  getAppSlug(): string {
    return "office365-calendar";
  }

  getDisplayName(): string {
    return "Microsoft Outlook Calendar";
  }

  private async setupZoomCredential(userId: number, zoomUserId: string): Promise<void> {
    const existing = await prisma.credential.findFirst({
      where: {
        userId,
        appId: "zoom",
        type: "zoom_video",
      },
    });

    if (existing) {
      await prisma.credential.update({
        where: { id: existing.id },
        data: { key: { zoomUserId } },
      });
    } else {
      await prisma.credential.create({
        data: {
          userId,
          type: "zoom_video",
          appId: "zoom",
          key: { zoomUserId },
        },
      });
    }
  }
}
