import { redis } from "@esa/cal-additions/lib/redis";
import { z } from "zod";

import dayjs from "@calcom/dayjs";
import logger from "@calcom/lib/logger";
import prisma from "@calcom/prisma";
import type { Credential } from "@calcom/prisma/client";
import { Frequency } from "@calcom/prisma/zod-utils";
import type { CalendarEvent } from "@calcom/types/Calendar";
import type { CredentialPayload } from "@calcom/types/Credential";
import type { PartialReference } from "@calcom/types/EventManager";
import type { VideoApiAdapter, VideoCallData } from "@calcom/types/VideoApiAdapter";

import type { ParseRefreshTokenResponse } from "../../_utils/oauth/parseRefreshTokenResponse";
import parseRefreshTokenResponse from "../../_utils/oauth/parseRefreshTokenResponse";
import refreshOAuthTokens from "../../_utils/oauth/refreshOAuthTokens";
import metadata from "../_metadata";
import { getZoomAppKeys } from "./getZoomAppKeys";

const log = logger.getSubLogger({ prefix: ["[lib] ZoomVideoApiAdapter"] });

/** @link https://marketplace.zoom.us/docs/api-reference/zoom-api/meetings/meetingcreate */
const zoomEventResultSchema = z.object({
  id: z.number(),
  join_url: z.string(),
  password: z.string().optional().default(""),
});

export type ZoomEventResult = z.infer<typeof zoomEventResultSchema>;

/** @link https://marketplace.zoom.us/docs/api-reference/zoom-api/methods/#operation/meetings */
export const zoomMeetingsSchema = z.object({
  next_page_token: z.string(),
  page_count: z.number(),
  page_number: z.number(),
  page_size: z.number(),
  total_records: z.number(),
  meetings: z.array(
    z.object({
      agenda: z.string(),
      created_at: z.string(),
      duration: z.number(),
      host_id: z.string(),
      id: z.number(),
      join_url: z.string(),
      pmi: z.string(),
      start_time: z.string(),
      timezone: z.string(),
      topic: z.string(),
      type: z.number(),
      uuid: z.string(),
    })
  ),
});

const invalidateCredential = async (credentialId: Credential["id"]) => {
  log.warn(`Invalidating Zoom credential`, { credentialId });

  const credential = await prisma.credential.findUnique({
    where: {
      id: credentialId,
    },
  });

  if (credential) {
    await prisma.credential.update({
      where: {
        id: credentialId,
      },
      data: {
        invalid: true,
      },
    });
    log.error(`Zoom credential marked as invalid`, { credentialId });
  } else {
    log.error(`Failed to find credential to invalidate`, { credentialId });
  }
};

// Successful API response
// @TODO: add link to the docs
const zoomTokenSchema = z.object({
  scope: z.string().regex(new RegExp("meeting:write")),
  expiry_date: z.number(),
  expires_in: z.number().optional(), // deprecated, purely for backwards compatibility; superseeded by expiry_date.
  token_type: z.literal("bearer"),
  access_token: z.string(),
  refresh_token: z.string(),
  user_id: z.string().optional(),
});

type ZoomToken = z.infer<typeof zoomTokenSchema>;

const isTokenValid = (token: Partial<ZoomToken>) =>
  zoomTokenSchema.safeParse(token).success && (token.expires_in || token.expiry_date || 0) > Date.now();

/** @link https://marketplace.zoom.us/docs/guides/auth/oauth/#request */
const zoomRefreshedTokenSchema = z.object({
  access_token: z.string(),
  token_type: z.literal("bearer"),
  refresh_token: z.string(),
  expires_in: z.number(),
  scope: z.string(),
});

const zoomAuth = (credential: CredentialPayload) => {
  const refreshAccessToken = async (refreshToken: string, noOfRetries = 0) => {
    const MAX_RETRIES = 2;
    log.debug(`Refreshing Zoom access token`, {
      credentialId: credential.id,
      userId: credential.userId,
      attempt: noOfRetries + 1,
      maxRetries: MAX_RETRIES + 1,
    });

    const { client_id, client_secret } = await getZoomAppKeys();
    const authHeader = `Basic ${Buffer.from(`${client_id}:${client_secret}`).toString("base64")}`;

    log.silly(`Zoom OAuth refresh request`, {
      endpoint: "https://zoom.us/oauth/token",
      grantType: "refresh_token",
      credentialId: credential.id,
    });

    const response = await refreshOAuthTokens(
      async () =>
        await fetch("https://zoom.us/oauth/token", {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            refresh_token: refreshToken,
            grant_type: "refresh_token",
          }),
        }),
      metadata.slug,
      credential.userId
    );

    const responseBody = await handleZoomResponse(response);

    if (responseBody?.error) {
      log.error(`Zoom token refresh failed`, {
        error: responseBody.error,
        credentialId: credential.id,
        attempt: noOfRetries + 1,
      });

      if (responseBody.error === "invalid_grant") {
        log.error(`Invalid grant detected - invalidating credential`, { credentialId: credential.id });
        await invalidateCredential(credential.id);
        return Promise.reject(new Error("Invalid grant for Cal.com zoom app"));
      } else {
        if (noOfRetries <= MAX_RETRIES) {
          log.warn(`Retrying Zoom token refresh`, {
            credentialId: credential.id,
            nextAttempt: noOfRetries + 2,
            maxRetries: MAX_RETRIES + 1,
          });
          refreshAccessToken(refreshToken, noOfRetries + 1);
        } else {
          log.error(`Max retries exceeded for Zoom token refresh`, {
            credentialId: credential.id,
            attempts: MAX_RETRIES + 1,
            error: responseBody.error,
          });
          return Promise.reject(
            new Error(
              `Unable to retrieve access token using refresh token after ${
                MAX_RETRIES + 1
              } attempts due to error: ${responseBody.error}`
            )
          );
        }
      }
    }
    // We check the if the new credentials matches the expected response structure
    const newTokens: ParseRefreshTokenResponse<typeof zoomRefreshedTokenSchema> = parseRefreshTokenResponse(
      responseBody,
      zoomRefreshedTokenSchema
    );

    const key = credential.key as ZoomToken;
    key.access_token = newTokens.access_token ?? key.access_token;
    key.refresh_token = (newTokens.refresh_token as string) ?? key.refresh_token;
    // set expiry date as offset from current time.
    key.expiry_date =
      typeof newTokens.expires_in === "number"
        ? Math.round(Date.now() + newTokens.expires_in * 1000)
        : key.expiry_date;

    log.debug(`Zoom token refreshed successfully`, {
      credentialId: credential.id,
      expiresIn: newTokens.expires_in,
      expiryDate: new Date(key.expiry_date).toISOString(),
      scope: newTokens.scope,
    });

    // Store new tokens in database.
    await prisma.credential.update({
      where: { id: credential.id },
      data: { key: { ...key, ...newTokens } },
    });

    log.silly(`Updated Zoom credential in database`, { credentialId: credential.id });

    return newTokens.access_token;
  };

  const serverToServerAuth = async () => {
    const cacheKey = `zoom.server.to.server.auth.access.token`;

    log.debug(`Attempting Zoom server-to-server authentication`, {
      credentialId: credential.id,
      userId: credential.userId,
    });

    const cachedToken = await redis.get(cacheKey);
    if (cachedToken) {
      log.debug(`Using cached Zoom S2S token`, {
        credentialId: credential.id,
        cacheKey,
      });
      return cachedToken;
    }

    log.debug(`No cached token found, fetching new S2S token`, {
      credentialId: credential.id,
    });

    const accountId = process.env.ZOOM_SERVER_TO_SERVER_ACCOUNT_ID || "";
    const clientId = process.env.ZOOM_SERVER_TO_SERVER_CLIENT_ID || "";
    const clientSecret = process.env.ZOOM_SERVER_TO_SERVER_CLIENT_SECRET || "";

    if (!accountId || !clientId || !clientSecret) {
      log.error(`Missing Zoom S2S configuration`, {
        hasAccountId: !!accountId,
        hasClientId: !!clientId,
        hasClientSecret: !!clientSecret,
      });
    }

    const authHeader = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;

    log.silly(`Making Zoom S2S token request`, {
      endpoint: "https://zoom.us/oauth/token",
      grantType: "account_credentials",
      accountId: `${accountId.substring(0, 8)}...`, // Partial account ID for security
    });

    const response = await fetch("https://zoom.us/oauth/token", {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "account_credentials",
        account_id: accountId,
      }),
    });

    const responseBody: { access_token: string; expires_in: number } = await handleZoomResponse(response);

    if (responseBody?.access_token) {
      const expiresIn = responseBody.expires_in - 1;
      await redis.setex(cacheKey, expiresIn, responseBody.access_token);

      log.debug(`Zoom S2S token obtained and cached`, {
        credentialId: credential.id,
        expiresIn,
        expiryTime: new Date(Date.now() + expiresIn * 1000).toISOString(),
      });
    } else {
      log.error(`Failed to obtain Zoom S2S token`, {
        credentialId: credential.id,
        responseStatus: response?.status,
      });
    }

    return responseBody.access_token;
  };

  return {
    getToken: async () => {
      const credentialKey = credential.key as ZoomToken;
      const isManagedSetup = !!credentialKey.zoomUserId;

      log.debug(`Getting Zoom token`, {
        credentialId: credential.id,
        isManagedSetup,
        userId: isManagedSetup ? credentialKey.zoomUserId : credential.userId,
        tokenType: isManagedSetup ? "server-to-server" : "oauth",
      });

      if (isManagedSetup) {
        log.debug(`Using server-to-server auth for managed setup`, {
          credentialId: credential.id,
          zoomUserId: credentialKey.zoomUserId,
        });
        return serverToServerAuth();
      }

      const tokenValid = isTokenValid(credentialKey);
      log.debug(`OAuth token validation`, {
        credentialId: credential.id,
        isValid: tokenValid,
        expiryDate: credentialKey.expiry_date ? new Date(credentialKey.expiry_date).toISOString() : "unknown",
      });

      if (tokenValid) {
        log.silly(`Using existing valid OAuth token`, { credentialId: credential.id });
        return Promise.resolve(credentialKey.access_token);
      } else {
        log.debug(`OAuth token expired or invalid, refreshing`, { credentialId: credential.id });
        return refreshAccessToken(credentialKey.refresh_token);
      }
    },
  };
};

type ZoomRecurrence = {
  end_date_time?: string;
  type: 1 | 2 | 3;
  end_times?: number;
  repeat_interval?: number;
  weekly_days?: number; // 1-7 Sunday = 1, Saturday = 7
  monthly_day?: number; // 1-31
};

const ZoomVideoApiAdapter = (credential: CredentialPayload): VideoApiAdapter => {
  const getUserId = () => {
    const credentialKey = credential.key as ZoomToken;
    const userId = credentialKey.zoomUserId || "me";
    log.silly(`Zoom getUserId`, {
      credentialId: credential.id,
      userId,
      isManagedSetup: !!credentialKey.zoomUserId,
    });
    return userId;
  };

  const translateEvent = (event: CalendarEvent) => {
    const getRecurrence = ({
      recurringEvent,
      startTime,
      attendees,
    }: CalendarEvent): { recurrence: ZoomRecurrence; type: 8 } | undefined => {
      if (!recurringEvent) {
        return;
      }

      let recurrence: ZoomRecurrence;

      switch (recurringEvent.freq) {
        case Frequency.DAILY:
          recurrence = {
            type: 1,
          };
          break;
        case Frequency.WEEKLY:
          recurrence = {
            type: 2,
            weekly_days: dayjs(startTime).tz(attendees[0].timeZone).day() + 1,
          };
          break;
        case Frequency.MONTHLY:
          recurrence = {
            type: 3,
            monthly_day: dayjs(startTime).tz(attendees[0].timeZone).date(),
          };
          break;
        default:
          // Zoom does not support YEARLY, HOURLY or MINUTELY frequencies, don't do anything in those cases.
          return;
      }

      recurrence.repeat_interval = recurringEvent.interval;

      if (recurringEvent.until) {
        recurrence.end_date_time = recurringEvent.until.toISOString();
      } else {
        recurrence.end_times = recurringEvent.count;
      }

      return {
        recurrence: {
          ...recurrence,
        },
        type: 8,
      };
    };

    const recurrence = getRecurrence(event);
    // Documentation at: https://marketplace.zoom.us/docs/api-reference/zoom-api/meetings/meetingcreate
    return {
      topic: event.title,
      type: 2, // Means that this is a scheduled meeting
      start_time: dayjs(event.startTime).utc().format(),
      duration: (new Date(event.endTime).getTime() - new Date(event.startTime).getTime()) / 60000,
      //schedule_for: "string",   TODO: Used when scheduling the meeting for someone else (needed?)
      timezone: event.organizer.timeZone,
      //password: "string",       TODO: Should we use a password? Maybe generate a random one?
      agenda: event.description,
      settings: {
        host_video: true,
        participant_video: true,
        cn_meeting: false, // TODO: true if host meeting in China
        in_meeting: false, // TODO: true if host meeting in India
        join_before_host: true,
        mute_upon_entry: false,
        watermark: false,
        use_pmi: false,
        approval_type: 2,
        audio: "both",
        auto_recording: "none",
        enforce_login: false,
        registrants_email_notification: true,
      },
      ...recurrence,
    };
  };

  const fetchZoomApi = async (endpoint: string, options?: RequestInit) => {
    const startTime = Date.now();
    const auth = zoomAuth(credential);

    log.debug(`Fetching Zoom API`, {
      endpoint,
      method: options?.method || "GET",
      credentialId: credential.id,
    });

    const accessToken = await auth.getToken();

    log.silly(`Zoom API request details`, {
      url: `https://api.zoom.us/v2/${endpoint}`,
      method: options?.method || "GET",
      hasBody: !!options?.body,
    });

    const response = await fetch(`https://api.zoom.us/v2/${endpoint}`, {
      method: "GET",
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...options?.headers,
      },
    });

    const duration = Date.now() - startTime;

    log.debug(`Zoom API response`, {
      endpoint,
      method: options?.method || "GET",
      status: response.status,
      statusText: response.statusText,
      duration: `${duration}ms`,
      credentialId: credential.id,
    });

    if (!response.ok) {
      log.error(`Zoom API error response`, {
        endpoint,
        status: response.status,
        statusText: response.statusText,
        duration: `${duration}ms`,
        credentialId: credential.id,
      });
    }

    const responseBody = await handleZoomResponse(response);

    log.silly(`Zoom API response body`, {
      endpoint,
      hasError: !!responseBody?.error,
      responseType: typeof responseBody,
      credentialId: credential.id,
    });

    return responseBody;
  };

  const createMeeting = async (event: CalendarEvent): Promise<VideoCallData> => {
    const startTime = Date.now();
    const userId = getUserId();

    log.debug(`Creating Zoom meeting`, {
      credentialId: credential.id,
      userId,
      eventTitle: event.title,
      eventStart: event.startTime,
      eventEnd: event.endTime,
      attendees: event.attendees.length,
      isRecurring: !!event.recurringEvent,
    });

    try {
      const translatedEvent = translateEvent(event);

      log.silly(`Zoom meeting request payload`, {
        credentialId: credential.id,
        topic: translatedEvent.topic,
        duration: translatedEvent.duration,
        timezone: translatedEvent.timezone,
        type: translatedEvent.type,
        hasRecurrence: !!translatedEvent.recurrence,
      });

      const response = await fetchZoomApi(`users/${userId}/meetings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(translatedEvent),
      });

      if (response?.error) {
        log.error(`Zoom meeting creation failed with error`, {
          credentialId: credential.id,
          error: response.error,
          errorMessage: response.message,
          duration: `${Date.now() - startTime}ms`,
        });
        return Promise.reject(new Error(`Error creating meeting: ${response.error}`));
      }

      const result = zoomEventResultSchema.parse(response);

      if (result.id && result.join_url) {
        log.debug(`Zoom meeting created successfully`, {
          credentialId: credential.id,
          meetingId: result.id,
          hasPassword: !!result.password,
          duration: `${Date.now() - startTime}ms`,
        });

        return {
          type: "zoom_video",
          id: result.id.toString(),
          password: result.password || "",
          url: result.join_url,
        };
      }

      log.error(`Zoom meeting creation response missing required fields`, {
        credentialId: credential.id,
        hasId: !!result.id,
        hasJoinUrl: !!result.join_url,
        duration: `${Date.now() - startTime}ms`,
      });

      throw new Error(`Failed to create meeting. Response is ${JSON.stringify(result)}`);
    } catch (err) {
      log.error(`Zoom meeting creation exception`, {
        credentialId: credential.id,
        error: err instanceof Error ? err.message : "Unknown error",
        errorType: err?.constructor?.name,
        duration: `${Date.now() - startTime}ms`,
      });
      /* Prevents meeting creation failure when Zoom Token is expired */
      throw new Error("Unexpected error");
    }
  };

  return {
    getZoomUsers: async () => {
      log.debug(`Fetching Zoom users list`, {
        credentialId: credential.id,
      });

      const result = await fetchZoomApi(`users`);

      log.debug(`Zoom users fetched`, {
        credentialId: credential.id,
        userCount: result?.users?.length || 0,
      });

      return result;
    },
    getAvailability: async () => {
      const userId = getUserId();

      log.debug(`Fetching Zoom availability`, {
        credentialId: credential.id,
        userId,
        pageSize: 300,
      });

      try {
        // TODO Possibly implement pagination for cases when there are more than 300 meetings already scheduled.
        const responseBody = await fetchZoomApi(`users/${userId}/meetings?type=scheduled&page_size=300`);

        const data = zoomMeetingsSchema.parse(responseBody);

        log.debug(`Zoom availability fetched`, {
          credentialId: credential.id,
          userId,
          meetingCount: data.meetings.length,
          totalRecords: data.total_records,
          pageCount: data.page_count,
          needsPagination: data.total_records > 300,
        });

        if (data.total_records > 300) {
          log.warn(`Zoom availability exceeds page size limit`, {
            credentialId: credential.id,
            totalRecords: data.total_records,
            pageSize: 300,
            message: "Pagination needed but not implemented",
          });
        }

        return data.meetings.map((meeting) => ({
          start: meeting.start_time,
          end: new Date(new Date(meeting.start_time).getTime() + meeting.duration * 60000).toISOString(),
        }));
      } catch (err) {
        log.error(`Failed to fetch Zoom availability`, {
          credentialId: credential.id,
          userId,
          error: err instanceof Error ? err.message : "Unknown error",
          errorType: err?.constructor?.name,
        });
        /* Prevents booking failure when Zoom Token is expired */
        return [];
      }
    },
    createMeeting,
    deleteMeeting: async (uid: string): Promise<void> => {
      log.debug(`Deleting Zoom meeting`, {
        credentialId: credential.id,
        meetingId: uid,
      });

      try {
        const response = await fetchZoomApi(`meetings/${uid}`, {
          method: "DELETE",
        });

        if (response?.error) {
          log.error(`Zoom meeting deletion failed`, {
            credentialId: credential.id,
            meetingId: uid,
            error: response.error,
            errorMessage: response.message,
          });
          return Promise.reject(new Error(`Error deleting meeting: ${response.error}`));
        }

        log.debug(`Zoom meeting deleted successfully`, {
          credentialId: credential.id,
          meetingId: uid,
        });

        return Promise.resolve();
      } catch (err) {
        log.error(`Zoom meeting deletion exception`, {
          credentialId: credential.id,
          meetingId: uid,
          error: err instanceof Error ? err.message : "Unknown error",
          errorType: err?.constructor?.name,
        });
        return Promise.reject(new Error("Failed to delete meeting"));
      }
    },
    updateMeeting: async (bookingRef: PartialReference, event: CalendarEvent): Promise<VideoCallData> => {
      const startTime = Date.now();

      log.debug(`Updating Zoom meeting`, {
        credentialId: credential.id,
        hasUid: !!bookingRef.uid,
        hasMeetingId: !!bookingRef.meetingId,
        eventTitle: event.title,
        eventStart: event.startTime,
        eventEnd: event.endTime,
      });

      try {
        if (!bookingRef.uid || !bookingRef.meetingId) {
          log.warn(`Missing Zoom meeting reference, creating new meeting instead`, {
            credentialId: credential.id,
            hasUid: !!bookingRef.uid,
            hasMeetingId: !!bookingRef.meetingId,
          });

          let result;
          try {
            result = await createMeeting(event);

            if (result.id && result.url) {
              const { id, password = "", url } = result;

              bookingRef.meetingId = id;
              bookingRef.meetingPassword = password;
              bookingRef.meetingUrl = url;

              log.debug(`Zoom meeting created as fallback for update`, {
                credentialId: credential.id,
                meetingId: id,
                duration: `${Date.now() - startTime}ms`,
              });

              return Promise.resolve({
                type: "zoom_video",
                id: bookingRef.meetingId as string,
                password: bookingRef.meetingPassword as string,
                url: bookingRef.meetingUrl as string,
              });
            }
          } catch (e) {
            log.error(`Failed to create Zoom meeting as fallback for update`, {
              credentialId: credential.id,
              error: e instanceof Error ? e.message : "Unknown error",
              duration: `${Date.now() - startTime}ms`,
            });
            return Promise.reject(
              new Error("Failed to update meeting by using creating for nonexisting bookingRef")
            );
          }
        }

        const translatedEvent = translateEvent(event);

        log.silly(`Zoom meeting update payload`, {
          credentialId: credential.id,
          meetingId: bookingRef.uid,
          topic: translatedEvent.topic,
          duration: translatedEvent.duration,
        });

        await fetchZoomApi(`meetings/${bookingRef.uid}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(translatedEvent),
        });

        log.debug(`Zoom meeting updated successfully`, {
          credentialId: credential.id,
          meetingId: bookingRef.uid,
          duration: `${Date.now() - startTime}ms`,
        });

        return Promise.resolve({
          type: "zoom_video",
          id: bookingRef.meetingId as string,
          password: bookingRef.meetingPassword as string,
          url: bookingRef.meetingUrl as string,
        });
      } catch (err) {
        log.error(`Zoom meeting update failed`, {
          credentialId: credential.id,
          meetingId: bookingRef.uid,
          error: err instanceof Error ? err.message : "Unknown error",
          errorType: err?.constructor?.name,
          duration: `${Date.now() - startTime}ms`,
        });
        return Promise.reject(new Error("Failed to update meeting"));
      }
    },
  } as unknown as VideoApiAdapter;
};

const handleZoomResponse = async (response: Response) => {
  let _response = response.clone();
  const responseClone = response.clone();

  log.silly(`Handling Zoom response`, {
    status: response.status,
    statusText: response.statusText,
    contentEncoding: response.headers.get("content-encoding"),
    contentType: response.headers.get("content-type"),
  });

  if (_response.headers.get("content-encoding") === "gzip") {
    log.silly(`Decoding gzip-encoded Zoom response`);
    const responseString = await response.text();
    _response = JSON.parse(responseString);
  }

  if (!response.ok || (response.status < 200 && response.status >= 300)) {
    const responseBody = await _response.json();

    log.error(`Zoom API returned error response`, {
      status: response.status,
      statusText: response.statusText,
      error: responseBody.error,
      message: responseBody.message,
      code: responseBody.code,
    });

    if (responseBody.error !== "invalid_grant") {
      responseBody.error = response.statusText;
    }
    return responseBody;
  }

  // handle 204 response code with empty response (causes crash otherwise as "" is invalid JSON)
  if (response.status === 204) {
    log.silly(`Zoom API returned 204 No Content`);
    return;
  }

  return responseClone.json();
};

export default ZoomVideoApiAdapter;
