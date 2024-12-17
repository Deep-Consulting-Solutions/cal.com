// eslint-disable-next-line no-restricted-imports
import { chunk, countBy } from "lodash";
import { v4 as uuid } from "uuid";
import { stringify, parse } from 'flatted';

import { getAggregatedAvailability } from "@calcom/core/getAggregatedAvailability";
import { getBusyTimesForLimitChecks } from "@calcom/core/getBusyTimes";
import type { CurrentSeats } from "@calcom/core/getUserAvailability";
import { getUserAvailability } from "@calcom/core/getUserAvailability";
import type { Dayjs } from "@calcom/dayjs";
import dayjs from "@calcom/dayjs";
import { getSlugOrRequestedSlug, orgDomainConfig } from "@calcom/ee/organizations/lib/orgDomains";
import { isEventTypeLoggingEnabled } from "@calcom/features/bookings/lib/isEventTypeLoggingEnabled";
import { parseBookingLimit, parseDurationLimit } from "@calcom/lib";
import { getDefaultEvent } from "@calcom/lib/defaultEvents";
import isTimeOutOfBounds from "@calcom/lib/isOutOfBounds";
import logger from "@calcom/lib/logger";
import { performance } from "@calcom/lib/server/perfObserver";
import { UserRepository } from "@calcom/lib/server/repository/user";
import getSlots from "@calcom/lib/slots";
import prisma, { availabilityUserSelect } from "@calcom/prisma";
import { Prisma } from "@calcom/prisma/client";
import { SchedulingType } from "@calcom/prisma/enums";
import { BookingStatus } from "@calcom/prisma/enums";
import { credentialForCalendarServiceSelect } from "@calcom/prisma/selects/credential";
import { EventTypeMetaDataSchema } from "@calcom/prisma/zod-utils";
import type { EventBusyDate } from "@calcom/types/Calendar";

import { TRPCError } from "@trpc/server";

import type { GetScheduleOptions } from "./getSchedule.handler";
import type { TGetScheduleInputSchema } from "./getSchedule.schema";
import { redis } from "../../../../../esa/lib/redis";
import { freeBusyStore, responseStore } from "../../../../../esa/store/store";


export const checkIfIsAvailable = ({
  time,
  busy,
  eventLength,
  currentSeats,
}: {
  time: Dayjs;
  busy: EventBusyDate[];
  eventLength: number;
  currentSeats?: CurrentSeats;
}): boolean => {
  if (currentSeats?.some((booking) => booking.startTime.toISOString() === time.toISOString())) {
    return true;
  }

  const slotEndTime = time.add(eventLength, "minutes").utc();
  const slotStartTime = time.utc();

  return busy.every((busyTime) => {
    const startTime = dayjs.utc(busyTime.start).utc();
    const endTime = dayjs.utc(busyTime.end);

    if (endTime.isBefore(slotStartTime) || startTime.isAfter(slotEndTime)) {
      return true;
    }

    if (slotStartTime.isBetween(startTime, endTime, null, "[)")) {
      return false;
    } else if (slotEndTime.isBetween(startTime, endTime, null, "(]")) {
      return false;
    }

    // Check if start times are the same
    if (time.utc().isBetween(startTime, endTime, null, "[)")) {
      return false;
    }
    // Check if slot end time is between start and end time
    else if (slotEndTime.isBetween(startTime, endTime)) {
      return false;
    }
    // Check if startTime is between slot
    else if (startTime.isBetween(time, slotEndTime)) {
      return false;
    }

    return true;
  });
};

async function getEventTypeId({
  slug,
  eventTypeSlug,
  isTeamEvent,
  organizationDetails,
}: {
  slug?: string;
  eventTypeSlug?: string;
  isTeamEvent: boolean;
  organizationDetails?: { currentOrgDomain: string | null; isValidOrgDomain: boolean };
}) {
  if (!eventTypeSlug || !slug) return null;

  let teamId;
  let userId;
  if (isTeamEvent) {
    teamId = await getTeamIdFromSlug(
      slug,
      organizationDetails ?? { currentOrgDomain: null, isValidOrgDomain: false }
    );
  } else {
    userId = await getUserIdFromUsername(
      slug,
      organizationDetails ?? { currentOrgDomain: null, isValidOrgDomain: false }
    );
  }
  const eventType = await prisma.eventType.findFirst({
    where: {
      slug: eventTypeSlug,
      ...(teamId ? { teamId } : {}),
      ...(userId ? { userId } : {}),
    },
    select: {
      id: true,
    },
  });
  if (!eventType) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
  return eventType?.id;
}

export async function getEventType(
  input: TGetScheduleInputSchema,
  organizationDetails: { currentOrgDomain: string | null; isValidOrgDomain: boolean }
) {
  const { eventTypeSlug, usernameList, isTeamEvent } = input;
  const eventTypeId =
    input.eventTypeId ||
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    (await getEventTypeId({
      slug: usernameList?.[0],
      eventTypeSlug: eventTypeSlug,
      isTeamEvent,
      organizationDetails,
    }));

  if (!eventTypeId) {
    return null;
  }

  const eventType = await prisma.eventType.findUnique({
    where: {
      id: eventTypeId,
    },
    select: {
      id: true,
      slug: true,
      minimumBookingNotice: true,
      length: true,
      offsetStart: true,
      seatsPerTimeSlot: true,
      timeZone: true,
      slotInterval: true,
      beforeEventBuffer: true,
      afterEventBuffer: true,
      bookingLimits: true,
      durationLimits: true,
      assignAllTeamMembers: true,
      schedulingType: true,
      periodType: true,
      periodStartDate: true,
      periodEndDate: true,
      onlyShowFirstAvailableSlot: true,
      periodCountCalendarDays: true,
      periodDays: true,
      metadata: true,
      schedule: {
        select: {
          availability: {
            select: {
              date: true,
              startTime: true,
              endTime: true,
              days: true,
            },
          },
          timeZone: true,
        },
      },
      availability: {
        select: {
          date: true,
          startTime: true,
          endTime: true,
          days: true,
        },
      },
      hosts: {
        select: {
          isFixed: true,
          user: {
            select: {
              credentials: { select: credentialForCalendarServiceSelect },
              ...availabilityUserSelect,
            },
          },
        },
      },
      users: {
        select: {
          credentials: { select: credentialForCalendarServiceSelect },
          ...availabilityUserSelect,
        },
      },
    },
  });

  if (!eventType) {
    return null;
  }

  return {
    ...eventType,
    metadata: EventTypeMetaDataSchema.parse(eventType.metadata),
  };
}

export async function getDynamicEventType(
  input: TGetScheduleInputSchema,
  organizationDetails: { currentOrgDomain: string | null; isValidOrgDomain: boolean }
) {
  const { currentOrgDomain, isValidOrgDomain } = organizationDetails;
  // For dynamic booking, we need to get and update user credentials, schedule and availability in the eventTypeObject as they're required in the new availability logic
  if (!input.eventTypeSlug) {
    throw new TRPCError({
      message: "eventTypeSlug is required for dynamic booking",
      code: "BAD_REQUEST",
    });
  }
  const dynamicEventType = getDefaultEvent(input.eventTypeSlug);
  const { where } = await UserRepository._getWhereClauseForFindingUsersByUsername({
    orgSlug: isValidOrgDomain ? currentOrgDomain : null,
    usernameList: Array.isArray(input.usernameList)
      ? input.usernameList
      : input.usernameList
      ? [input.usernameList]
      : [],
  });
  const users = await prisma.user.findMany({
    where,
    select: {
      allowDynamicBooking: true,
      ...availabilityUserSelect,
      credentials: {
        select: credentialForCalendarServiceSelect,
      },
    },
  });
  const isDynamicAllowed = !users.some((user) => !user.allowDynamicBooking);
  if (!isDynamicAllowed) {
    throw new TRPCError({
      message: "Some of the users in this group do not allow dynamic booking",
      code: "UNAUTHORIZED",
    });
  }
  return Object.assign({}, dynamicEventType, {
    users,
  });
}

export function getRegularOrDynamicEventType(
  input: TGetScheduleInputSchema,
  organizationDetails: { currentOrgDomain: string | null; isValidOrgDomain: boolean }
) {
  const isDynamicBooking = input.usernameList && input.usernameList.length > 1;
  return isDynamicBooking
    ? getDynamicEventType(input, organizationDetails)
    : getEventType(input, organizationDetails);
}

const selectSelectedSlots = Prisma.validator<Prisma.SelectedSlotsDefaultArgs>()({
  select: {
    id: true,
    slotUtcStartDate: true,
    slotUtcEndDate: true,
    userId: true,
    isSeat: true,
    eventTypeId: true,
  },
});

type SelectedSlots = Prisma.SelectedSlotsGetPayload<typeof selectSelectedSlots>;

function applyOccupiedSeatsToCurrentSeats(currentSeats: CurrentSeats, occupiedSeats: SelectedSlots[]) {
  const occupiedSeatsCount = countBy(occupiedSeats, (item) => item.slotUtcStartDate.toISOString());
  Object.keys(occupiedSeatsCount).forEach((date) => {
    currentSeats.push({
      uid: uuid(),
      startTime: dayjs(date).toDate(),
      _count: { attendees: occupiedSeatsCount[date] },
    });
  });
  return currentSeats;
}

const getAvailableSlotsCacheKeyPrefix = 'getAvailableSlotsCache_';

export async function getAvailableSlots({ input, ctx }: GetScheduleOptions, bypassCacheResponse = false) {
  // check the cache for a response with this timezone
  const cacheKey = `${getAvailableSlotsCacheKeyPrefix}${input.timeZone}_${input.startTime}_${input.endTime}_${input.eventTypeId || ''}_${input.eventTypeSlug || ''}`;
  
  if((!input.rescheduleUid) && !bypassCacheResponse  || ( !!input.rescheduleUid && process.env.AVAILABLE_SLOTS_CACHE_ON_RESCHEDULE === 'true' && !bypassCacheResponse)){
    const responseDetails = responseStore[cacheKey];
    if(responseDetails){
      // const responseDetails: any = parse(response);
      return (responseDetails.response) as {
        slots: Record<string, {
            time: string;
            attendees?: number | undefined;
            bookingUid?: string | undefined;
        }[]>;
    };
    }
  }
  const orgDetails = orgDomainConfig(ctx?.req);
  if (process.env.INTEGRATION_TEST_MODE === "true") {
    logger.settings.minLevel = 2;
  }
  const startPrismaEventTypeGet = performance.now();
  const eventType = await getRegularOrDynamicEventType(input, orgDetails);
  const endPrismaEventTypeGet = performance.now();

  if (!eventType) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  if (isEventTypeLoggingEnabled({ eventTypeId: eventType.id })) {
    logger.settings.minLevel = 2;
  }

  const loggerWithEventDetails = logger.getSubLogger({
    prefix: ["getAvailableSlots", `${eventType.id}:${input.usernameList}/${input.eventTypeSlug}`],
  });

  loggerWithEventDetails.debug(
    `Prisma eventType get took ${endPrismaEventTypeGet - startPrismaEventTypeGet}ms for event:${
      input.eventTypeId
    }`
  );
  const getStartTime = (startTimeInput: string, timeZone?: string) => {
    const startTimeMin = dayjs.utc().add(eventType.minimumBookingNotice || 1, "minutes");
    const startTime = timeZone === "Etc/GMT" ? dayjs.utc(startTimeInput) : dayjs(startTimeInput).tz(timeZone);

    return startTimeMin.isAfter(startTime) ? startTimeMin.tz(timeZone) : startTime;
  };

  const startTime = getStartTime(input.startTime, input.timeZone);
  const endTime =
    input.timeZone === "Etc/GMT" ? dayjs.utc(input.endTime) : dayjs(input.endTime).utc().tz(input.timeZone);

  if (!startTime.isValid() || !endTime.isValid()) {
    throw new TRPCError({ message: "Invalid time range given.", code: "BAD_REQUEST" });
  }
  let currentSeats: CurrentSeats | undefined;

  let usersWithCredentials = eventType.users.map((user) => ({
    isFixed: !eventType.schedulingType || eventType.schedulingType === SchedulingType.COLLECTIVE,
    ...user,
  }));
  // overwrite if it is a team event & hosts is set, otherwise keep using users.
  if (eventType.schedulingType && !!eventType.hosts?.length) {
    usersWithCredentials = eventType.hosts.map(({ isFixed, user }) => ({ isFixed, ...user }));
  }

  const durationToUse = input.duration || 0;

  const startTimeDate =
    input.rescheduleUid && durationToUse
      ? startTime.subtract(durationToUse, "minute").toDate()
      : startTime.toDate();

  const endTimeDate =
    input.rescheduleUid && durationToUse ? endTime.add(durationToUse, "minute").toDate() : endTime.toDate();

  const sharedQuery = {
    startTime: { lte: endTimeDate },
    endTime: { gte: startTimeDate },
    status: {
      in: [BookingStatus.ACCEPTED],
    },
  };

  const allUserIds = usersWithCredentials.map((user) => user.id);

  const currentBookingsAllUsers = await prisma.booking.findMany({
    where: {
      OR: [
        // User is primary host (individual events, or primary organizer)
        {
          ...sharedQuery,
          userId: {
            in: allUserIds,
          },
        },
        // The current user has a different booking at this time he/she attends
        {
          ...sharedQuery,
          attendees: {
            some: {
              email: {
                in: usersWithCredentials.map((user) => user.email),
              },
            },
          },
        },
      ],
    },
    select: {
      id: true,
      uid: true,
      userId: true,
      startTime: true,
      endTime: true,
      title: true,
      attendees: true,
      eventType: {
        select: {
          id: true,
          onlyShowFirstAvailableSlot: true,
          afterEventBuffer: true,
          beforeEventBuffer: true,
          seatsPerTimeSlot: true,
        },
      },
      ...(!!eventType?.seatsPerTimeSlot && {
        _count: {
          select: {
            seatsReferences: true,
          },
        },
      }),
    },
  });

  const bookingLimits = parseBookingLimit(eventType?.bookingLimits);
  const durationLimits = parseDurationLimit(eventType?.durationLimits);
  let busyTimesFromLimitsBookingsAllUsers: Awaited<ReturnType<typeof getBusyTimesForLimitChecks>> = [];

  if (eventType && (bookingLimits || durationLimits)) {
    busyTimesFromLimitsBookingsAllUsers = await getBusyTimesForLimitChecks({
      userIds: allUserIds,
      eventTypeId: eventType.id,
      startDate: startTime.format(),
      endDate: endTime.format(),
      rescheduleUid: input.rescheduleUid,
      bookingLimits,
      durationLimits,
    });
  }

  /* We get all users working hours and busy slots */
  const allUsersAvailability = await Promise.all(
    usersWithCredentials.map(async (currentUser) => {
      const {
        busy,
        dateRanges,
        currentSeats: _currentSeats,
        timeZone,
      } = await getUserAvailability(
        {
          userId: currentUser.id,
          username: currentUser.username || "",
          dateFrom: startTime.format(),
          dateTo: endTime.format(),
          eventTypeId: eventType.id,
          afterEventBuffer: eventType.afterEventBuffer,
          beforeEventBuffer: eventType.beforeEventBuffer,
          duration: input.duration || 0,
          returnDateOverrides: false,
        },
        {
          user: currentUser,
          eventType,
          currentSeats,
          rescheduleUid: input.rescheduleUid,
          currentBookings: currentBookingsAllUsers
            .filter(
              (b) => b.userId === currentUser.id || b.attendees?.some((a) => a.email === currentUser.email)
            )
            .map((bookings) => {
              const { attendees: _attendees, ...bookingWithoutAttendees } = bookings;
              return bookingWithoutAttendees;
            }),
          busyTimesFromLimitsBookings: busyTimesFromLimitsBookingsAllUsers.filter(
            (b) => b.userId === currentUser.id
          ),
        }
      );
      if (!currentSeats && _currentSeats) currentSeats = _currentSeats;
      return {
        timeZone,
        dateRanges,
        busy,
        user: currentUser,
      };
    })
  );

  const availabilityCheckProps = {
    eventLength: input.duration || eventType.length,
    currentSeats,
  };

  const isTimeWithinBounds = (_time: Parameters<typeof isTimeOutOfBounds>[0]) =>{ 
    const isTimeWithinBounds = !isTimeOutOfBounds(_time, {
      periodType: eventType.periodType,
      periodStartDate: eventType.periodStartDate,
      periodEndDate: eventType.periodEndDate,
      periodCountCalendarDays: eventType.periodCountCalendarDays,
      periodDays: eventType.periodDays,
    });
    console.log({_time, isTimeWithinBounds})
    return isTimeWithinBounds;
  }

  const getSlotsTime = 0;
  const checkForAvailabilityTime = 0;
  const getSlotsCount = 0;
  const checkForAvailabilityCount = 0;
  const aggregatedAvailability = getAggregatedAvailability(allUsersAvailability, eventType.schedulingType);

  const timeSlots = getSlots({
    inviteeDate: startTime,
    eventLength: input.duration || eventType.length,
    offsetStart: eventType.offsetStart,
    dateRanges: aggregatedAvailability,
    minimumBookingNotice: eventType.minimumBookingNotice,
    frequency: eventType.slotInterval || input.duration || eventType.length,
    organizerTimeZone:
      eventType.timeZone || eventType?.schedule?.timeZone || allUsersAvailability?.[0]?.timeZone,
  });

  let availableTimeSlots: typeof timeSlots = [];
  // Load cached busy slots
  const selectedSlots =
    /* FIXME: For some reason this returns undefined while testing in Jest */
    (await prisma.selectedSlots.findMany({
      where: {
        userId: { in: usersWithCredentials.map((user) => user.id) },
        releaseAt: { gt: dayjs.utc().format() },
      },
      ...selectSelectedSlots,
    })) || [];
  await prisma.selectedSlots.deleteMany({
    where: { eventTypeId: { equals: eventType.id }, id: { notIn: selectedSlots.map((item) => item.id) } },
  });

  availableTimeSlots = timeSlots;

  if (selectedSlots?.length > 0) {
    let occupiedSeats: typeof selectedSlots = selectedSlots.filter(
      (item) => item.isSeat && item.eventTypeId === eventType.id
    );
    if (occupiedSeats?.length) {
      const addedToCurrentSeats: string[] = [];
      if (typeof availabilityCheckProps.currentSeats !== "undefined") {
        availabilityCheckProps.currentSeats = availabilityCheckProps.currentSeats.map((item) => {
          const attendees =
            occupiedSeats.filter(
              (seat) => seat.slotUtcStartDate.toISOString() === item.startTime.toISOString()
            )?.length || 0;
          if (attendees) addedToCurrentSeats.push(item.startTime.toISOString());
          return {
            ...item,
            _count: {
              attendees: item._count.attendees + attendees,
            },
          };
        });
        occupiedSeats = occupiedSeats.filter(
          (item) => !addedToCurrentSeats.includes(item.slotUtcStartDate.toISOString())
        );
      }

      availabilityCheckProps.currentSeats = applyOccupiedSeatsToCurrentSeats(
        availabilityCheckProps.currentSeats || [],
        occupiedSeats
      );

      currentSeats = availabilityCheckProps.currentSeats;
    }
    availableTimeSlots = availableTimeSlots
      .map((slot) => {
        const busy = selectedSlots.reduce<EventBusyDate[]>((r, c) => {
          if (!c.isSeat) {
            r.push({ start: c.slotUtcStartDate, end: c.slotUtcEndDate });
          }
          return r;
        }, []);

        if (
          checkIfIsAvailable({
            time: slot.time,
            busy,
            ...availabilityCheckProps,
          })
        ) {
          return slot;
        }
        return undefined;
      })
      .filter(
        (
          item:
            | {
                time: dayjs.Dayjs;
                userIds?: number[] | undefined;
              }
            | undefined
        ): item is {
          time: dayjs.Dayjs;
          userIds?: number[] | undefined;
        } => {
          return !!item;
        }
      );
  }

  availableTimeSlots = availableTimeSlots.filter((slot) => isTimeWithinBounds(slot.time));
  // fr-CA uses YYYY-MM-DD
  const formatter = new Intl.DateTimeFormat("fr-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: input.timeZone,
  });

  const computedAvailableSlots = availableTimeSlots.reduce(
    (
      r: Record<string, { time: string; attendees?: number; bookingUid?: string }[]>,
      { time, ...passThroughProps }
    ) => {
      // TODO: Adds unit tests to prevent regressions in getSchedule (try multiple timezones)

      // This used to be _time.tz(input.timeZone) but Dayjs tz() is slow.
      // toLocaleDateString slugish, using Intl.DateTimeFormat we get the desired speed results.
      const dateString = formatter.format(time.toDate());

      r[dateString] = r[dateString] || [];
      if (eventType.onlyShowFirstAvailableSlot && r[dateString].length > 0) {
        return r;
      }
      r[dateString].push({
        ...passThroughProps,
        time: time.toISOString(),
        // Conditionally add the attendees and booking id to slots object if there is already a booking during that time
        ...(currentSeats?.some((booking) => booking.startTime.toISOString() === time.toISOString()) && {
          attendees:
            currentSeats[
              currentSeats.findIndex((booking) => booking.startTime.toISOString() === time.toISOString())
            ]._count.attendees,
          bookingUid:
            currentSeats[
              currentSeats.findIndex((booking) => booking.startTime.toISOString() === time.toISOString())
            ].uid,
        }),
      });
      return r;
    },
    Object.create(null)
  );

  loggerWithEventDetails.debug(`getSlots took ${getSlotsTime}ms and executed ${getSlotsCount} times`);

  loggerWithEventDetails.debug(
    `checkForAvailability took ${checkForAvailabilityTime}ms and executed ${checkForAvailabilityCount} times`
  );
  loggerWithEventDetails.debug(`Available slots: ${JSON.stringify(computedAvailableSlots)}`);

  if((!input.rescheduleUid) || ( !!input.rescheduleUid && process.env.AVAILABLE_SLOTS_CACHE_ON_RESCHEDULE === 'true')){
    // store the response for a particular computation, it will then keep refreshing itself until it end date passes
    const responseDataToCache: {
      response: any;
      userIDs: number[];
      input: any; 
      ctx: any;
      dateFrom: string;
      dateTo: string;
      eventTypeSlug: string;
  } = {
      input, 
      ctx, 
      userIDs: allUserIds,
      response: {
      slots: computedAvailableSlots,
      },
      dateFrom: input.startTime,
      dateTo: input.endTime,
      eventTypeSlug: input.eventTypeSlug || ''
    }
    responseStore[cacheKey] = responseDataToCache;
  }

  return {
    slots: computedAvailableSlots,
  };
}

async function getUserIdFromUsername(
  username: string,
  organizationDetails: { currentOrgDomain: string | null; isValidOrgDomain: boolean }
) {
  const { currentOrgDomain, isValidOrgDomain } = organizationDetails;

  const [user] = await UserRepository.findUsersByUsername({
    usernameList: [username],
    orgSlug: isValidOrgDomain ? currentOrgDomain : null,
  });
  return user?.id;
}

async function getTeamIdFromSlug(
  slug: string,
  organizationDetails: { currentOrgDomain: string | null; isValidOrgDomain: boolean }
) {
  const { currentOrgDomain, isValidOrgDomain } = organizationDetails;
  const team = await prisma.team.findFirst({
    where: {
      slug,
      parent: isValidOrgDomain && currentOrgDomain ? getSlugOrRequestedSlug(currentOrgDomain) : null,
    },
    select: {
      id: true,
    },
  });
  return team?.id;
}

export enum CACHE_REFRESH_REASON_ENUM  {
  EVENT_UPDATED = 'EVENT_UPDATED',
  MEETING_BOOKED = 'MEETING_BOOKED',
  EXTERNAL_CALENDAR_UPDATE = 'EXTERNAL_CALENDAR_UPDATE'
}

export const refreshAvailableSlotsCache = async (
  cacheRefeshReason: CACHE_REFRESH_REASON_ENUM = CACHE_REFRESH_REASON_ENUM.EXTERNAL_CALENDAR_UPDATE,
  userIDs?: (string | number)[],
  startTime?: string | Date,
  endTime?: string | Date,
) => {
  try {
    const allKeys = Object.keys(responseStore);

    const delay10millisecs = async () => {
      await new Promise((resolve, reject) => {
        setTimeout(()=>{
          resolve(true);
        }, 10)
      })
      return;
    }
    const batchedKeysArr = chunk(allKeys, Number( process.env.AVAILABLE_SLOTS_CACHE_CHUNK_SIZE|| 20));
    for (const batchedKeys of batchedKeysArr) {
      await Promise.all(
        batchedKeys.map(async (getAvailableSlotsCacheKey: any) => {
          const dataToRefresh = responseStore[getAvailableSlotsCacheKey];
          // Check if the users have their data on Zohocalendar or on cal changed, if not do not refresh
          // ///////// Make sure to add a small wait with Promise so that control can be handed over to the request handlers  
          // ///////// to respond to requests quickly.
          if (dataToRefresh){
            let changedCalendarAvailabilities: {
              dateFrom: string;
              dateTo: string;
            }[] = [];
            let shouldRefreshBecauseUserAvailabilityInCalWasUpdated = false; 
            if(cacheRefeshReason === CACHE_REFRESH_REASON_ENUM.EXTERNAL_CALENDAR_UPDATE){
              dataToRefresh.userIDs.forEach(userID => {
                const userChangedAvailabilities = Object.values(freeBusyStore[userID] || {}).filter((avail)=> avail.changed);
                changedCalendarAvailabilities = [...changedCalendarAvailabilities, ...userChangedAvailabilities];
              });
            } else if (cacheRefeshReason === CACHE_REFRESH_REASON_ENUM.MEETING_BOOKED) {
              // check if the users in the booked meeting are related to the users in this cache
              const isCachedDataForUserInBookedMeeting = dataToRefresh.userIDs.some(userID => userIDs?.map(us => Number(us)).includes(userID))
              if(!isCachedDataForUserInBookedMeeting){
                // wait 10 milliseconds before continuing
                await delay10millisecs();
                return;
              }
              console.log(`About to refresh response cache for ${getAvailableSlotsCacheKey}, meeting booked`)
              changedCalendarAvailabilities = [
                {
                  dateFrom: startTime || '',
                  dateTo: endTime || '',
                }
              ]
            } else if (cacheRefeshReason === CACHE_REFRESH_REASON_ENUM.EVENT_UPDATED) {
              shouldRefreshBecauseUserAvailabilityInCalWasUpdated = dataToRefresh.userIDs.some(userID => userIDs?.map(us => Number(us)).includes(userID));    
              console.log(`About to refresh response cache, user availability changed ${getAvailableSlotsCacheKey}`)
            }
            
            
            // Should refresh if data is in the range + or - 2 days of the changed data
            const startDateToUseInChecks = dayjs(dataToRefresh.dateFrom).subtract(2, 'days');
            const endDateToUseInChecks = dayjs(dataToRefresh.dateTo).add(2, 'days');
            
            const shouldRefreshCacheForKey = changedCalendarAvailabilities.some((changedAvailabilityRange) => {
              const changedAvailabilityStartTime = dayjs(changedAvailabilityRange.dateFrom);
              const changedAvailabilityEndTime = dayjs(changedAvailabilityRange.dateTo);

              return changedAvailabilityStartTime.isBetween(
                startDateToUseInChecks,
                endDateToUseInChecks,
                'milliseconds',
                "[]"
              ) || changedAvailabilityEndTime.isBetween(
                startDateToUseInChecks,
                endDateToUseInChecks,
                'milliseconds',
                "[]"
              )
            })

            if(shouldRefreshCacheForKey || shouldRefreshBecauseUserAvailabilityInCalWasUpdated){
              // check if end time has passed and remove the item from cache else, refresh it
              // TODO_ESA: this logic may need to be modified to have a better cache clearing strategy
              if(new Date() < new Date(dataToRefresh.input.endTime)){
                console.log(`Refreshing response cache for user ${getAvailableSlotsCacheKey}`)
                await getAvailableSlots(dataToRefresh, true);
              } else{
                delete responseStore[getAvailableSlotsCacheKey];
                // wait 10 milliseconds before continuing
                await delay10millisecs();
              } 
            } else {
              console.log(`Skipped refreshing response cache for user ${getAvailableSlotsCacheKey}`)
              // wait 10 milliseconds before continuing
              await delay10millisecs();
            }
            // wait 10 milliseconds before continuing
            await delay10millisecs();
          } else {
            // wait 10 milliseconds before continuing
            await delay10millisecs();
          }
        })
      );
    }
  } catch (error) {
    // TODO_ESA: Add incident reporting here when cache refresh fails
    console.log(`error in refreshAvailableSlotsCache`, error);
  } 
}

setInterval(()=>{
  refreshAvailableSlotsCache()
}, Number(process.env.AVAILABLE_SLOTS_CACHE_REFRESH_INTERVAL_MILLIS || 8*1000))



// const initResponseStore = async () => {
//   try {
//     const allKeys = await redis.keys(`${getAvailableSlotsCacheKeyPrefix}*`);

//     const batchedKeysArr = chunk(allKeys, Number( process.env.AVAILABLE_SLOTS_CACHE_CHUNK_SIZE|| 20));
//     for (const batchedKeys of batchedKeysArr) {
//       await Promise.all(
//         batchedKeys.map(async (getAvailableSlotsCacheKey: any) => {
//           const dataInStore = await redis.get(getAvailableSlotsCacheKey);
//           if(dataInStore){
//             responseStore[getAvailableSlotsCacheKey] = parse(dataInStore);
//           }
//         })
//       );
//     }
//   } catch (error) {
//     // TODO_ESA: Add incident reporting here when cache refresh fails
//     console.log(`error in initResponseStore`, error);
//   } 
// }

// setTimeout(()=>{
//   initResponseStore()
// }, 0)
