import { m } from "framer-motion";
import dynamic from "next/dynamic";
import { shallow } from "zustand/shallow";

import { useEmbedUiConfig, useIsEmbed } from "@calcom/embed-core/embed-iframe";
import { EventDetails, EventMembersMore, EventMetaSkeleton, EventTitle } from "@calcom/features/bookings";
import { SeatsAvailabilityText } from "@calcom/features/bookings/components/SeatsAvailabilityText";
import { EventMetaBlock } from "@calcom/features/bookings/components/event-meta/Details";
import { useTimePreferences } from "@calcom/features/bookings/lib";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { ArrowLeft } from "@calcom/ui/components/icon";
import { Calendar, Globe, User } from "@calcom/ui/components/icon";

import { fadeInUp } from "../config";
import { useBookerStore } from "../store";
import { FromToTime } from "../utils/dates";
import type { useEventReturnType } from "../utils/event";

const TimezoneSelect = dynamic(
  () => import("@calcom/ui/components/form/timezone-select/TimezoneSelect").then((mod) => mod.TimezoneSelect),
  {
    ssr: false,
  }
);

export const EventMetaMore = ({
  event,
  isPending,
  onGoBack,
}: {
  event: useEventReturnType["data"];
  isPending: useEventReturnType["isPending"];
  onGoBack?: () => void;
}) => {
  const { setTimezone, timeFormat, timezone } = useTimePreferences();
  const selectedDuration = useBookerStore((state) => state.selectedDuration);
  const selectedTimeslot = useBookerStore((state) => state.selectedTimeslot);
  const bookerState = useBookerStore((state) => state.state);
  const bookingData = useBookerStore((state) => state.bookingData);
  const rescheduleUid = useBookerStore((state) => state.rescheduleUid);
  const [seatedEventData] = useBookerStore(
    (state) => [state.seatedEventData, state.setSeatedEventData],
    shallow
  );
  const { i18n, t } = useLocale();
  const embedUiConfig = useEmbedUiConfig();
  const isEmbed = useIsEmbed();
  const hideEventTypeDetails = isEmbed ? embedUiConfig.hideEventTypeDetails : false;

  if (hideEventTypeDetails) {
    return null;
  }
  // If we didn't pick a time slot yet, we load bookingData via SSR so bookingData should be set
  // Otherwise we load seatedEventData from useBookerStore
  const bookingSeatAttendeesQty = seatedEventData?.attendees || bookingData?.attendees.length;
  const eventTotalSeats = seatedEventData?.seatsPerTimeSlot || event?.seatsPerTimeSlot;

  const isHalfFull =
    bookingSeatAttendeesQty && eventTotalSeats && bookingSeatAttendeesQty / eventTotalSeats >= 0.5;
  const isNearlyFull =
    bookingSeatAttendeesQty && eventTotalSeats && bookingSeatAttendeesQty / eventTotalSeats >= 0.83;

  const colorClass = isNearlyFull
    ? "text-rose-600"
    : isHalfFull
    ? "text-yellow-500"
    : "text-bookinghighlight";

  return (
    <div
      className="border-subtle bg-default dark:bg-muted relative z-10 border-b-2 p-4"
      data-testid="event-meta">
      {isPending && (
        <m.div {...fadeInUp} initial="visible" layout>
          <EventMetaSkeleton />
        </m.div>
      )}
      {!isPending && !!event && (
        <m.div {...fadeInUp} layout transition={{ ...fadeInUp.transition, delay: 0.3 }}>
          {!!onGoBack && (
            <button
              className="border-subtle absolute left-4 top-4 flex h-8 w-8 items-center justify-center rounded-full border"
              onClick={onGoBack}>
              <ArrowLeft className="dark:text-emphasis w-6 text-[#0069FF]" />
            </button>
          )}
          <EventMembersMore
            schedulingType={event.schedulingType}
            users={event.users}
            profile={event.profile}
            entity={event.entity}
          />
          <EventTitle className="my-2 text-center">{event?.title}</EventTitle>
          {event.description && (
            <EventMetaBlock
              className="justify-center"
              contentClassName="mb-8 break-words max-w-full max-h-[180px] scroll-bar pr-4">
              <div dangerouslySetInnerHTML={{ __html: event.description }} />
            </EventMetaBlock>
          )}
          <div className="mx-auto flex max-w-[500px] flex-wrap items-center justify-center gap-x-6 gap-y-4 font-medium rtl:-mr-2">
            {rescheduleUid && bookingData && (
              <EventMetaBlock icon={Calendar}>
                {t("former_time")}
                <br />
                <span className="line-through" data-testid="former_time_p">
                  <FromToTime
                    date={bookingData.startTime.toString()}
                    duration={null}
                    timeFormat={timeFormat}
                    timeZone={timezone}
                    language={i18n.language}
                  />
                </span>
              </EventMetaBlock>
            )}
            <EventDetails event={event} />
            {selectedTimeslot && (
              <EventMetaBlock icon={Calendar}>
                <FromToTime
                  date={selectedTimeslot}
                  duration={selectedDuration || event.length}
                  timeFormat={timeFormat}
                  timeZone={timezone}
                  language={i18n.language}
                  showInOneLine
                />
              </EventMetaBlock>
            )}

            <EventMetaBlock
              className="cursor-pointer [&_.current-timezone:before]:focus-within:opacity-100 [&_.current-timezone:before]:hover:opacity-100"
              contentClassName="relative max-w-[90%]"
              icon={Globe}>
              {bookerState === "booking" ? (
                <>{timezone}</>
              ) : (
                <span
                  className={`min-w-32 current-timezone before:bg-subtle -mt-[2px] flex h-6 max-w-full items-center justify-start before:absolute before:inset-0 before:bottom-[-3px] before:left-[-30px] before:top-[-3px] before:w-[calc(100%_+_35px)] before:rounded-md before:py-3 before:opacity-0 before:transition-opacity ${
                    event.lockTimeZoneToggleOnBookingPage ? "cursor-not-allowed" : ""
                  }`}>
                  <TimezoneSelect
                    menuPosition="fixed"
                    classNames={{
                      control: () => "!min-h-0 p-0 w-full border-0 bg-transparent focus-within:ring-0",
                      menu: () => "!w-64 max-w-[90vw]",
                      singleValue: () => "text-text py-1",
                      indicatorsContainer: () => "ml-auto",
                      container: () => "max-w-full",
                    }}
                    value={timezone}
                    onChange={(tz) => setTimezone(tz.value)}
                    isDisabled={event.lockTimeZoneToggleOnBookingPage}
                  />
                </span>
              )}
            </EventMetaBlock>
            {bookerState === "booking" && eventTotalSeats && bookingSeatAttendeesQty ? (
              <EventMetaBlock icon={User} className={`${colorClass}`}>
                <div className="text-bookinghighlight flex items-start text-sm">
                  <p>
                    <SeatsAvailabilityText
                      showExact={!!seatedEventData.showAvailableSeatsCount}
                      totalSeats={eventTotalSeats}
                      bookedSeats={bookingSeatAttendeesQty || 0}
                      variant="fraction"
                    />
                  </p>
                </div>
              </EventMetaBlock>
            ) : null}
          </div>
        </m.div>
      )}
    </div>
  );
};
