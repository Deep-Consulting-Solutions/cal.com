import { Dayjs} from "@calcom/dayjs";
import type { CredentialPayload } from "@calcom/types/Credential";
import type { IntegrationCalendar} from "@calcom/types/Calendar";

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
            integrationCalendars: IntegrationCalendar[]
            dateFrom: string;
            dateTo: string;
            lastUpdatedAt: Dayjs;
        }
    }
}

interface ResponseStore {
    [responseKey: string]: {
        response: any;
        userIDs: number[];
        input: any; 
        ctx: any;
        dateFrom: string;
        dateTo: string;
        eventTypeSlug: string;
    }
}

export let freeBusyStore: FreeBusyStore = {};
export let userInfoStore: {[key: string]: any} = {};
export let responseStore: ResponseStore = {};



// Reset the user info store hourly
setInterval(()=>{
    userInfoStore={};
}, Number(3600 * 1000))