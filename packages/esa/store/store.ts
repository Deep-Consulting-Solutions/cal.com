import type { Dayjs } from "@calcom/dayjs";
import type { IntegrationCalendar } from "@calcom/types/Calendar";
import type { CredentialPayload } from "@calcom/types/Credential";

export interface FreeBusyResponse {
  freebusy: {
    startTime: string;
    endTime: string;
    fbtype: string;
  }[];
}

interface FreeBusyStore {
  [userID: string]: {
    [availabilityKey: string]: {
      changed: boolean;
      response: FreeBusyResponse;
      credential: CredentialPayload;
      integrationCalendars: IntegrationCalendar[];
      dateFrom: string;
      dateTo: string;
      lastUpdatedAt: Dayjs;
    };
  };
}

export interface ResponseStoreKeyData {
  response: any;
  userIDs: number[];
  input: any;
  ctx: any;
  dateFrom: string;
  dateTo: string;
  eventTypeSlug: string;
}

interface ResponseStore {
  [responseKey: string]: ResponseStoreKeyData;
}

export const freeBusyStore: FreeBusyStore = {};
export let userInfoStore: { [key: string]: any } = {};
export const responseStore: ResponseStore = {};

// Reset the user info store hourly
setInterval(() => {
  userInfoStore = {};
}, Number(3600 * 1000));
