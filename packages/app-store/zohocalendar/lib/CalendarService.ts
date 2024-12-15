import moment from "moment";
import { stringify } from "querystring";
import { z } from "zod";

import dayjs from "@calcom/dayjs";
import { getLocation, getRichDescription } from "@calcom/lib/CalEventParser";
import logger from "@calcom/lib/logger";
import prisma from "@calcom/prisma";
import type {
  Calendar,
  CalendarEvent,
  EventBusyDate,
  IntegrationCalendar,
  NewCalendarEventType,
} from "@calcom/types/Calendar";
import type { CredentialPayload } from "@calcom/types/Credential";

import getAppKeysFromSlug from "../../_utils/getAppKeysFromSlug";
import type { ZohoAuthCredentials, FreeBusy, ZohoCalendarListResp } from "../types/ZohoCalendar";
import { zohoClient } from '../../../esa/lib/zoho';
// import { redis } from "../../../esa/lib/redis";
import { freeBusyStore, userInfoStore, FreeBusyResponse } from "../../../esa/store/store";

const zohoKeysSchema = z.object({
  client_id: z.string(),
  client_secret: z.string(),
});

export default class ZohoCalendarService implements Calendar {
  private integrationName = "";
  private log: typeof logger;
  auth: { getToken: () => Promise<ZohoAuthCredentials> };
  credential: CredentialPayload;
  calUserID: string;

  constructor(credential: CredentialPayload) {
    this.integrationName = "zoho_calendar";
    this.auth = this.zohoAuth(credential);
    this.log = logger.getSubLogger({
      prefix: [`[[lib] ${this.integrationName}`],
    });
    this.credential = credential;
    this.calUserID = credential.userId;
  }

  private zohoAuth = (credential: CredentialPayload) => {
    let zohoCredentials = credential.key as ZohoAuthCredentials;

    const refreshAccessToken = async () => {
      try {
        const appKeys = await getAppKeysFromSlug("zohocalendar");
        const { client_id, client_secret } = zohoKeysSchema.parse(appKeys);

        const params = {
          client_id,
          grant_type: "refresh_token",
          client_secret,
          refresh_token: zohoCredentials.refresh_token,
        };

        const query = stringify(params);

        const res = await fetch(`https://accounts.zoho.com/oauth/v2/token?${query}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=utf-8",
          },
        });

        const token = await res.json();

        const key: ZohoAuthCredentials = {
          access_token: token.access_token,
          refresh_token: zohoCredentials.refresh_token,
          expires_in: Math.round(+new Date() / 1000 + token.expires_in),
        };
        await prisma.credential.update({
          where: { id: credential.id },
          data: { key },
        });
        zohoCredentials = key;
      } catch (err) {
        this.log.error("Error refreshing zoho token", err);
      }
      return zohoCredentials;
    };

    return {
      getToken: async () => {
        const isExpired = () => new Date(zohoCredentials.expires_in * 1000).getTime() <= new Date().getTime();
        return !isExpired() ? Promise.resolve(zohoCredentials) : refreshAccessToken();
      },
    };
  };

  private fetcher = async (endpoint: string, init?: RequestInit | undefined) => {
    const credentials = await this.auth.getToken();

    return await zohoClient().calendar().passRequestAsProxy({
      method: "GET" as any,
      url: endpoint,
      ...(init || {}),
      headers: {
        Authorization: `Bearer ${credentials.access_token}`,
        "Content-Type": "application/json",
        ...init?.headers,
      } as any,
      data: {},
      params: {},
    })
  };

  private getUserInfo = async (calendarID: string) => {
    // Swap this to use zoho utils as 
    // const response = await fetch(`https://accounts.zoho.com/oauth/user/info`, {
    //   method: "GET",
    //   headers: {
    //     Authorization: `Bearer ${credentials.access_token}`,
    //     "Content-Type": "application/json",
    //   },
    // });

    let response: any = userInfoStore[calendarID];

    if(!response){
      const credentials = await this.auth.getToken();
      response = await zohoClient().calendar().passRequestAsProxy({
        method: "GET" as any,
        url: `https://accounts.zoho.com/oauth/user/info`,
        headers: {
          Authorization: `Bearer ${credentials.access_token}`,
          "Content-Type": "application/json",
          ignoreBaseUrl: true,
        } as any,
        data: {},
        params: {},
      })
      
      userInfoStore[calendarID] = response;
    }

    return this.handleData(response, this.log);
  };

  private hasZohoFreeBusyDataChanged = (currentDatarr: FreeBusyResponse, newDatarr: FreeBusyResponse) => {
    const oldData = currentDatarr;
    const newdata = newDatarr;
  
    if (oldData.freebusy.length === 0 && newdata.freebusy.length !== 0){
      return true;
    }
  
    if (newdata.freebusy.length === 0 && oldData.freebusy.length !== 0){
      return true;
    }
  
    const allDatainNewIsInOld = newdata.freebusy.every((newBusySlot) => {
      return !!oldData.freebusy.find(
        (oldBusySlot) =>
          newBusySlot.startTime === oldBusySlot.startTime &&
          newBusySlot.endTime === oldBusySlot.endTime
      );
    });
  
    const allDatainOldIsInNew = oldData.freebusy.every((oldBusySlot) => {
      return !!newdata.freebusy.find(
        (newBusySlot) =>
          oldBusySlot.startTime === newBusySlot.startTime &&
          oldBusySlot.endTime === newBusySlot.endTime
      );
    });
  
    return !(allDatainNewIsInOld && allDatainOldIsInNew);
  };

  async createEvent(event: CalendarEvent): Promise<NewCalendarEventType> {
    let eventId = "";
    let eventRespData;
    const [mainHostDestinationCalendar] = event.destinationCalendar ?? [];
    const calendarId = mainHostDestinationCalendar?.externalId;
    if (!calendarId) {
      throw new Error("no calendar id");
    }

    try {
      const query = stringify({
        eventdata: JSON.stringify(this.translateEvent(event)),
      });

      const eventResponse = await this.fetcher(`calendars/${calendarId}/events?${query}`, {
        method: "POST",
      });
      eventRespData = await this.handleData(eventResponse, this.log);
      eventId = eventRespData.events[0].uid as string;
    } catch (error) {
      this.log.error(error);
      throw error;
    }

    try {
      return {
        ...eventRespData.events[0],
        uid: eventRespData.events[0].uid as string,
        id: eventRespData.events[0].uid as string,
        type: "zoho_calendar",
        password: "",
        url: "",
        additionalInfo: {},
      };
    } catch (error) {
      this.log.error(error);
      await this.deleteEvent(eventId, event, calendarId);
      throw error;
    }
  }

  /**
   * @param uid
   * @param event
   * @returns
   */
  async updateEvent(uid: string, event: CalendarEvent, externalCalendarId?: string) {
    const eventId = uid;
    let eventRespData;
    const [mainHostDestinationCalendar] = event.destinationCalendar ?? [];
    const calendarId = externalCalendarId || mainHostDestinationCalendar?.externalId;
    if (!calendarId) {
      this.log.error("no calendar id provided in updateEvent");
      throw new Error("no calendar id provided in updateEvent");
    }
    try {
      // needed to fetch etag
      const existingEventResponse = await this.fetcher(`calendars/${calendarId}/events/${uid}`);
      const existingEventData = await this.handleData(existingEventResponse, this.log);

      const query = stringify({
        eventdata: JSON.stringify({
          ...this.translateEvent(event),
          etag: existingEventData.events[0].etag,
        }),
      });

      const eventResponse = await this.fetcher(`calendars/${calendarId}/events/${uid}?${query}`, {
        method: "PUT",
      });
      eventRespData = await this.handleData(eventResponse, this.log);
    } catch (error) {
      this.log.error(error);
      throw error;
    }

    try {
      return {
        ...eventRespData.events[0],
        uid: eventRespData.events[0].uid as string,
        id: eventRespData.events[0].uid as string,
        type: "zoho_calendar",
        password: "",
        url: "",
        additionalInfo: {},
      };
    } catch (error) {
      this.log.error(error);
      await this.deleteEvent(eventId, event);
      throw error;
    }
  }

  /**
   * @param uid
   * @param event
   * @returns
   */
  async deleteEvent(uid: string, event: CalendarEvent, externalCalendarId?: string) {
    const [mainHostDestinationCalendar] = event.destinationCalendar ?? [];
    const calendarId = externalCalendarId || mainHostDestinationCalendar?.externalId;
    if (!calendarId) {
      this.log.error("no calendar id provided in deleteEvent");
      throw new Error("no calendar id provided in deleteEvent");
    }
    try {
      // needed to fetch etag
      const existingEventResponse = await this.fetcher(`calendars/${calendarId}/events/${uid}`);
      const existingEventData = await this.handleData(existingEventResponse, this.log);

      const query = stringify({
        eventdata: JSON.stringify({
          uid,
          recurrence_edittype: "following",
          notify_attendee: 2,
          etag: existingEventData.events[0].etag,
        }),
      });

      const response = await this.fetcher(`calendars/${calendarId}/events/${uid}?${query}`, {
        method: "DELETE",
        headers: {
          etag: existingEventData.events[0].etag,
        },
      });
      await this.handleData(response, this.log);
    } catch (error) {
      this.log.error(error);
      throw error;
    }
  }

  private async getBusyData(dateFrom: string, dateTo: string, userEmail: string, additionalData: {
    itegrationCalendars: IntegrationCalendar[];
    defaultDateFrom: string;
    defaultDateTo: string;
  },
  skipCache: boolean
) {
    const query = stringify({
      sdate: dateFrom,
      edate: dateTo,
      ftype: "eventbased",
      uemail: userEmail,
    });

    const busyDataKey = `${dateFrom}${dateTo}${userEmail}`;
    const freeBusyUserDataAtKey  = !!freeBusyStore[this.calUserID]? freeBusyStore[this.calUserID][busyDataKey]: undefined;
    let response = !!freeBusyUserDataAtKey? freeBusyUserDataAtKey.response : undefined;
    if(!response || (!!response && skipCache)){
      // const cachedResponse = await redis.get(busyDataKey);
      // if(cachedResponse){
      //   response = JSON.parse(cachedResponse);
      // }

      // if(!response){
      response = (await this.fetcher(`calendars/freebusy?${query}`, {
        method: "GET",
      })) as FreeBusyResponse;
      const now = dayjs();
      if(!!freeBusyStore[this.calUserID]){
        if(!!freeBusyStore[this.calUserID][busyDataKey]){
          // case when the data already exists, we will need to compare with existing data
          freeBusyStore[this.calUserID][busyDataKey] = {
            changed: this.hasZohoFreeBusyDataChanged(freeBusyStore[this.calUserID][busyDataKey].response, response),
            credential: this.credential,
            dateFrom: additionalData.defaultDateFrom,
            dateTo: additionalData.defaultDateTo,
            integrationCalendars: additionalData.itegrationCalendars,
            lastUpdatedAt: now,
            response: response,
          }
        } else {
          freeBusyStore[this.calUserID][busyDataKey] = {
            changed: false,
            credential: this.credential,
            dateFrom: additionalData.defaultDateFrom,
            dateTo: additionalData.defaultDateTo,
            integrationCalendars: additionalData.itegrationCalendars,
            lastUpdatedAt: now,
            response: response,
          }
        }
      } else {
        freeBusyStore[this.calUserID] = {};
        freeBusyStore[this.calUserID][busyDataKey] = {
          changed: false,
          credential: this.credential,
          dateFrom: additionalData.defaultDateFrom,
          dateTo: additionalData.defaultDateTo,
          integrationCalendars: additionalData.itegrationCalendars,
          lastUpdatedAt: now,
          response: response,
        }

      }
      // await redis.setex(busyDataKey, Number(process.env.FREE_BUSY_CACHE_TTL_SECONDS || 15), JSON.stringify(response));
      // }
    }

    let data: any
    try {
      data = await this.handleData(response, this.log);
    } catch (error) {
      console.log(JSON.stringify({thegetBusyDataErrorrrrr: error}))
      throw error;
    }

    if (data.fb_not_enabled || data.NODATA) return [];

    return (
      data.freebusy
        .filter((freebusy: FreeBusy) => freebusy.fbtype === "busy")
        .map((freebusy: FreeBusy) => ({
          // using dayjs utc plugin because by default, dayjs parses and displays in local time, which causes a mismatch
          start: moment.utc(freebusy.startTime, "YYYYMMDDTHHmmssZ").toISOString(),
          end: moment.utc(freebusy.endTime, "YYYYMMDDTHHmmssZ").toISOString(),
        })) || []
    )
    
  }

  async getAvailability(
    dateFrom: string,
    dateTo: string,
    selectedCalendars: IntegrationCalendar[],
    skipCache = false
  ): Promise<EventBusyDate[]> {
    const selectedCalendarIds = selectedCalendars
      .filter((e) => e.integration === this.integrationName)
      .map((e) => e.externalId);

    if (selectedCalendarIds.length === 0 && selectedCalendars.length > 0) {
      // Only calendars of other integrations selected
      return Promise.resolve([]);
    }

    try {
      let queryIds = selectedCalendarIds;
      console.log("ZohoCalendarService.getAvailability", queryIds);

      if (queryIds.length === 0) {
        queryIds = (await this.listCalendars()).map((e) => e.externalId) || [];
        if (queryIds.length === 0) {
          return Promise.resolve([]);
        }
      }

      if (!selectedCalendars[0]) return [];

      const userInfo = await this.getUserInfo(selectedCalendarIds[0]);
      const originalStartDate = dayjs(dateFrom);
      const originalEndDate = dayjs(dateTo);
      const diff = originalEndDate.diff(originalStartDate, "days");

      if (diff <= 30) {
        const busyData = await this.getBusyData(
          originalStartDate.format("YYYYMMDD[T]HHmmss[Z]"),
          originalEndDate.format("YYYYMMDD[T]HHmmss[Z]"),
          userInfo.Email,
          {
            defaultDateFrom: dateFrom,
            defaultDateTo: dateTo,
            itegrationCalendars: selectedCalendars,
          },
          skipCache
        );
        return busyData;
      } else {
        // Zoho only supports 31 days of freebusy data
        const busyData = [];

        const loopsNumber = Math.ceil(diff / 30);

        let startDate = originalStartDate;
        let endDate = originalStartDate.add(30, "days");

        for (let i = 0; i < loopsNumber; i++) {
          if (endDate.isAfter(originalEndDate)) endDate = originalEndDate;

          busyData.push(
            ...(await this.getBusyData(
              startDate.format("YYYYMMDD[T]HHmmss[Z]"),
              endDate.format("YYYYMMDD[T]HHmmss[Z]"),
              userInfo.Email,
              {
                defaultDateFrom: dateFrom,
                defaultDateTo: dateTo,
                itegrationCalendars: selectedCalendars,
              },
              skipCache
            ))
          );

          startDate = endDate.add(1, "minutes");
          endDate = startDate.add(30, "days");
        }

        return busyData;
      }
    } catch (error) {
      this.log.error(error);
      return [];
    }
  }

  async listCalendarsRaw(): Promise<ZohoCalendarListResp> {
    try {
      const resp = await this.fetcher(`calendars`);
      const data = (await this.handleData(resp, this.log)) as ZohoCalendarListResp;

      return data;
    } catch (err) {
      this.log.error("There was an error contacting zoho calendar service: ", err);
      throw err;
    }
  }

  async listCalendars(): Promise<IntegrationCalendar[]> {
    try {
      const resp = await this.fetcher(`calendars`);
      const data = (await this.handleData(resp, this.log)) as ZohoCalendarListResp;
      const result = data.calendars
        .filter((cal) => {
          if (cal.privilege === "owner") {
            return true;
          }
          return false;
        })
        .map((cal) => {
          const calendar: IntegrationCalendar = {
            externalId: cal.uid ?? "No Id",
            integration: this.integrationName,
            name: cal.name || "No calendar name",
            primary: cal.isdefault,
            email: cal.uid ?? "",
          };
          return calendar;
        });

      if (result.some((cal) => !!cal.primary)) {
        return result;
      }

      // No primary calendar found, get primary calendar directly
      const respPrimary = await this.fetcher(`calendars?category=own`);
      const dataPrimary = (await this.handleData(respPrimary, this.log)) as ZohoCalendarListResp;
      return dataPrimary.calendars.map((cal) => {
        const calendar: IntegrationCalendar = {
          externalId: cal.uid ?? "No Id",
          integration: this.integrationName,
          name: cal.name || "No calendar name",
          primary: cal.isdefault,
          email: cal.uid ?? "",
        };
        return calendar;
      });
    } catch (err) {
      this.log.error("There was an error contacting zoho calendar service: ", err);
      throw err;
    }
  }

  async handleData(response: any, log: typeof logger) {
    console.log('handleDataInput', JSON.stringify(response));
    if (response.status >= 300 && response.status <= 199) {
      log.debug("zoho request with data", response);
      throw response;
    }
    log.debug("zoho request with data", response);
    return response;
  }

  private translateEvent = (event: CalendarEvent) => {
    const attendeeTimezone = event.attendees[0].timeZone;
    const zohoEvent = {
      title: event.title,
      description: getRichDescription(event, undefined, false, true),
      dateandtime: {
        start: dayjs(dayjs(event.startTime).tz(attendeeTimezone)).format("YYYYMMDDTHHmmssZZ"),
        // start: dayjs(event.startTime).format("YYYYMMDDTHHmmssZZ"),
        end: dayjs(dayjs(event.endTime).tz(attendeeTimezone)).format("YYYYMMDDTHHmmssZZ"),
        // end: dayjs(event.endTime).format("YYYYMMDDTHHmmssZZ"),
        timezone: attendeeTimezone,
        // timezone: event.organizer.timeZone,
      },
      attendees: event.attendees.map((attendee) => ({ email: attendee.email })),
      isprivate: event.seatsShowAttendees,
      reminders: [
        {
          minutes: "-15",
          action: "popup",
        },
      ],
      location: event.location ? getLocation(event) : undefined,
      notify_attendee: 2,
    };

    return zohoEvent;
  };
}


const refreshZohoFreeBusyData = async () => {
  try {
    await Promise.all(Object.entries(freeBusyStore).map(async ([userID, avaiabilityDataSet]) => {
      const usersAvailabilityEntries = Object.entries(avaiabilityDataSet);
      if(!usersAvailabilityEntries.length) return;
      const credential: CredentialPayload = avaiabilityDataSet[usersAvailabilityEntries[0][0]].credential;
      const usersZohoCalendarService = new ZohoCalendarService(credential);
      // For each availability key cached from zoho update the cache setting changed to true where a change has occurred so 
      for (const [availabilityKey, {dateFrom, dateTo, integrationCalendars}] of usersAvailabilityEntries){
        // if dateTo is in the past delete the key else continue
        const availabilityPeriodIsInPast = dayjs().add(1, 'day').isAfter(dayjs(dateTo), 'millisecond');

        if(!availabilityPeriodIsInPast) {
          // check if the availability data was updated within the last 20 seconds and skip if it has been
          const latestUpdateTime = freeBusyStore[userID][availabilityKey].lastUpdatedAt;
          const past20SecondTime = dayjs().subtract(20, "second");
          const isUpdatedInLast20seconds = latestUpdateTime.isAfter(past20SecondTime, 'millisecond');
          if(!isUpdatedInLast20seconds){
            await usersZohoCalendarService.getAvailability(dateFrom, dateTo, integrationCalendars, true);
          }
        } else {
          delete freeBusyStore[userID][availabilityKey];
        }
      }
    }))
  } catch (error) {
    // ESA_TODO: add incident reporting
    console.log(`Error refreshing free busy data on zoho`, error);
  }
}



setInterval(()=>{
  refreshZohoFreeBusyData();
}, Number(process.env.FREE_BUSY_CACHE_TTL_SECONDS || 30))
