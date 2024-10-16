import { useEffect, useMemo, useCallback, useState } from "react";
import { shallow } from "zustand/shallow";

import type { Dayjs } from "@calcom/dayjs";
import dayjs from "@calcom/dayjs";
import { useEmbedStyles } from "@calcom/embed-core/embed-iframe";
import { useBookerStore } from "@calcom/features/bookings/Booker/store";
import { getAvailableDatesInMonth } from "@calcom/features/calendars/lib/getAvailableDatesInMonth";
import classNames from "@calcom/lib/classNames";
import { daysInMonth, yyyymmdd } from "@calcom/lib/date-fns";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { weekdayNames } from "@calcom/lib/weekday";
import { Button, SkeletonText } from "@calcom/ui";
import { ChevronLeft, ChevronRight } from "@calcom/ui/components/icon";
import { ArrowRight } from "@calcom/ui/components/icon";

interface DayObject {
  day: null | Dayjs;
  disabled: boolean;
}

interface UseCalendarDaysProps {
  browsingDate: Dayjs;
  weekStart: number;
  minDate?: Date;
  includedDates?: string[];
  excludedDates?: string[];
  showOneMonth?: boolean;
}

export const useCalendarDays = ({
  browsingDate,
  weekStart,
  minDate,
  includedDates = [],
  excludedDates = [],
  showOneMonth,
}: UseCalendarDaysProps) => {
  // Create placeholder elements for empty days in first week
  const weekdayOfFirst = browsingDate.date(1).day();

  // Get available dates in the month
  const includedDatesInMonth = getAvailableDatesInMonth({
    browsingDate: browsingDate.toDate(),
    minDate,
    includedDates,
  });

  // Get available dates in the month
  const includedDatesNextMonth = getAvailableDatesInMonth({
    browsingDate: browsingDate.add(1, "month").toDate(),
    minDate,
    includedDates,
  });

  // Prepare days for the current month
  const days: (Dayjs | null)[] = Array((weekdayOfFirst - weekStart + 7) % 7).fill(null);
  for (let day = 1, dayCount = daysInMonth(browsingDate); day <= dayCount; day++) {
    const date = browsingDate.set("date", day);
    days.push(date);
  }

  // Prepare days for the next month
  const nextMonthDays: (Dayjs | null)[] = Array((weekdayOfFirst - weekStart + 7) % 7).fill(null);
  for (let day = 1, dayCount = daysInMonth(browsingDate.add(1, "month")); day <= dayCount; day++) {
    const date = browsingDate.add(1, "month").set("date", day);
    nextMonthDays.push(date);
  }

  const daysToRenderForTheMonth = useMemo(
    () =>
      days.map((day) => {
        if (!day) return { day: null, disabled: true };
        return {
          day,
          disabled:
            (includedDatesInMonth && !includedDatesInMonth.includes(yyyymmdd(day))) ||
            excludedDates.includes(yyyymmdd(day)),
        };
      }),
    [days, includedDatesInMonth, excludedDates]
  );

  const daysToRenderForNextMonth = useMemo(
    () =>
      nextMonthDays.map((day) => {
        if (!day) return { day: null, disabled: true };
        return {
          day,
          disabled: !(includedDates || []).includes(yyyymmdd(day)),
        };
      }),
    [nextMonthDays, includedDates]
  );

  // Check if next month should be rendered based on available days in the current month
  const availableDaysForTheMonth = daysToRenderForTheMonth.filter((day) => !day.disabled);
  const shouldRenderNextMonth = useMemo(() => {
    if (showOneMonth) return false;
    return (
      includedDatesInMonth.length > 0 &&
      availableDaysForTheMonth.length < 7 &&
      includedDatesNextMonth.length > 0
    );
  }, [includedDatesInMonth, availableDaysForTheMonth, includedDatesNextMonth, showOneMonth]);

  // Combine days from the current month and next month (if needed)
  const allDays = useMemo(() => {
    if (shouldRenderNextMonth) {
      return [...daysToRenderForTheMonth, ...daysToRenderForNextMonth.filter((d) => d.day)];
    }
    return daysToRenderForTheMonth;
  }, [shouldRenderNextMonth, daysToRenderForTheMonth, daysToRenderForNextMonth]);

  // Group days into weeks
  const weeks = useMemo(() => {
    const daysPerWeek = 7;
    const groupedWeeks: DayObject[][] = [];

    for (let i = 0; i < allDays.length; i += daysPerWeek) {
      groupedWeeks.push(allDays.slice(i, i + daysPerWeek));
    }

    if (includedDatesInMonth.length === 0 || !shouldRenderNextMonth) {
      return groupedWeeks;
    }

    // Helper to check if a week has available (non-disabled) days
    const hasAvailableDays = (week: DayObject[]) => week.some((day) => day && !day.disabled);

    // Find the first and last available week index
    const firstAvailableIndex = groupedWeeks.findIndex(hasAvailableDays);
    const lastAvailableIndex = groupedWeeks.slice().reverse().findIndex(hasAvailableDays);
    const adjustedLastAvailableIndex =
      lastAvailableIndex === -1 ? -1 : groupedWeeks.length - 1 - lastAvailableIndex;

    // Retain weeks between the first and last available week (inclusive)
    const boundedWeeks: DayObject[][] = [];
    let availableDaysCount = 0;

    if (firstAvailableIndex !== -1 && adjustedLastAvailableIndex !== -1) {
      for (let i = firstAvailableIndex; i <= adjustedLastAvailableIndex; i++) {
        const week = groupedWeeks[i];

        // Accumulate the available (non-disabled) days
        const availableDaysInWeek = week.filter((day) => day && !day.disabled).length;
        availableDaysCount += availableDaysInWeek;

        // Add the week to boundedWeeks
        boundedWeeks.push(week);

        // Stop once we have accumulated at least 7 available days
        if (availableDaysCount >= 7) {
          break;
        }
      }
    }

    // Check if boundedWeeks has less than 5 weeks, then find the index of the current week and slice the next 5 weeks
    if (boundedWeeks.length < 5 && availableDaysCount < 14) {
      const currentWeekIndex = groupedWeeks.findIndex((week) => week === boundedWeeks[0]);

      // If the currentWeekIndex is found, slice from that index to the end of groupedWeeks
      if (currentWeekIndex !== -1) {
        return groupedWeeks.slice(currentWeekIndex, currentWeekIndex + 5);
      }
    }

    return boundedWeeks;
  }, [allDays, includedDatesInMonth.length, shouldRenderNextMonth]);

  return {
    daysToRenderForTheMonth,
    daysToRenderForNextMonth,
    shouldRenderNextMonth,
    includedDatesInMonth,
    includedDatesNextMonth,
    weeks,
  };
};

export type DatePickerProps = {
  /** which day of the week to render the calendar. Usually Sunday (=0) or Monday (=1) - default: Sunday */
  weekStart?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** Fires whenever a selected date is changed. */
  onChange: (date: Dayjs | null, showOneMonth?: boolean) => void;
  /** Fires when the month is changed. */
  onMonthChange?: (date: Dayjs) => void;
  /** which date or dates are currently selected (not tracked from here) */
  selected?: Dayjs | Dayjs[] | null;
  /** defaults to current date. */
  minDate?: Date;
  /** Furthest date selectable in the future, default = UNLIMITED */
  maxDate?: Date;
  /** locale, any IETF language tag, e.g. "hu-HU" - defaults to Browser settings */
  locale: string;
  /** Defaults to [], which dates are not bookable. Array of valid dates like: ["2022-04-23", "2022-04-24"] */
  excludedDates?: string[];
  /** defaults to all, which dates are bookable (inverse of excludedDates) */
  includedDates?: string[];
  /** allows adding classes to the container */
  className?: string;
  /** Shows a small loading spinner next to the month name */
  isPending?: boolean;
  /** used to query the multiple selected dates */
  eventSlug?: string;
  /** Can be used to force the calendar to show just one month */
  showOneMonth?: boolean;
};

export const Day = ({
  date,
  active,
  disabled,
  ...props
}: JSX.IntrinsicElements["button"] & {
  active: boolean;
  date: Dayjs;
}) => {
  const { t } = useLocale();
  const enabledDateButtonEmbedStyles = useEmbedStyles("enabledDateButton");
  const disabledDateButtonEmbedStyles = useEmbedStyles("disabledDateButton");
  return (
    <button
      type="button"
      style={disabled ? { ...disabledDateButtonEmbedStyles } : { ...enabledDateButtonEmbedStyles }}
      className={classNames(
        "disabled:text-bookinglighter absolute bottom-0 left-0 right-0 top-0 mx-auto w-full rounded-full border-2 border-transparent text-center text-sm font-medium disabled:cursor-default disabled:border-transparent disabled:font-light lg:top-1 lg:h-12 lg:w-12 ",
        active
          ? "dark:bg-brand-default text-brand bg-[#0069FF] font-bold"
          : !disabled
          ? " dark:hover:border-brand-default dark:text-emphasis dark:bg-emphasis bg-[#eff5ff] font-bold text-[#0160E6] hover:border-[#0069FF]"
          : "text-muted"
      )}
      data-testid="day"
      data-disabled={disabled}
      disabled={disabled}
      {...props}>
      {date.date()}
      {date.isToday() && (
        <span
          className={classNames(
            "dark:bg-brand-default absolute left-1/2 top-1/2 flex h-[5px] w-[5px] -translate-x-1/2 translate-y-[8px] items-center justify-center rounded-full bg-[#0069FF] align-middle sm:translate-y-[12px]",
            active && "bg-brand-accent"
          )}>
          <span className="sr-only">{t("today")}</span>
        </span>
      )}
    </button>
  );
};

const NoAvailabilityOverlay = ({
  month,
  nextMonthButton,
}: {
  month: string | null;
  nextMonthButton: () => void;
}) => {
  const { t } = useLocale();

  return (
    <div className="bg-muted border-subtle absolute left-1/2 top-40 -mt-10 w-max -translate-x-1/2 -translate-y-1/2 transform rounded-md border p-8 shadow-sm">
      <h4 className="text-emphasis mb-4 font-medium">{t("no_availability_in_month", { month: month })}</h4>
      <Button onClick={nextMonthButton} color="primaryAlt" EndIcon={ArrowRight} data-testid="view_next_month">
        {t("view_next_month")}
      </Button>
    </div>
  );
};

const Days = ({
  minDate,
  excludedDates = [],
  browsingDate,
  weekStart,
  DayComponent = Day,
  selected,
  month,
  nextMonthButton,
  eventSlug,
  showOneMonth,
  ...props
}: Omit<DatePickerProps, "locale" | "className" | "weekStart"> & {
  DayComponent?: React.FC<React.ComponentProps<typeof Day>>;
  browsingDate: Dayjs;
  weekStart: number;
  month: string | null;
  nextMonthButton: () => void;
}) => {
  const { daysToRenderForTheMonth, weeks, includedDatesInMonth, shouldRenderNextMonth } = useCalendarDays({
    browsingDate,
    weekStart,
    minDate,
    excludedDates,
    includedDates: props.includedDates,
    showOneMonth,
  });

  const layout = useBookerStore((state) => state.layout, shallow);
  const [selectedDatesAndTimes] = useBookerStore((state) => [state.selectedDatesAndTimes], shallow);

  const isActive = (day: dayjs.Dayjs) => {
    // for selecting a range of dates
    if (Array.isArray(selected)) {
      return Array.isArray(selected) && selected?.some((e) => yyyymmdd(e) === yyyymmdd(day));
    }

    if (selected && yyyymmdd(selected) === yyyymmdd(day)) {
      return true;
    }

    // for selecting multiple dates for an event
    if (
      eventSlug &&
      selectedDatesAndTimes &&
      selectedDatesAndTimes[eventSlug as string] &&
      Object.keys(selectedDatesAndTimes[eventSlug as string]).length > 0
    ) {
      return Object.keys(selectedDatesAndTimes[eventSlug as string]).some((date) => {
        return yyyymmdd(dayjs(date)) === yyyymmdd(day);
      });
    }

    return false;
  };

  /**
   * Takes care of selecting a valid date in the month if the selected date is not available in the month.
   * Because of requirements, the function is not run when the layout is mobile.
   */
  const handleInitialDateSelection = useCallback(() => {
    if (selected instanceof Array) return;

    const firstAvailableDate = daysToRenderForTheMonth.find((day) => !day.disabled)?.day;
    const isSelectedDateAvailable = selected
      ? daysToRenderForTheMonth.some(
          ({ day, disabled }) => day && yyyymmdd(day) === yyyymmdd(selected) && !disabled
        )
      : false;

    if (!isSelectedDateAvailable && firstAvailableDate) {
      props.onChange(firstAvailableDate);
    }
  }, [selected, daysToRenderForTheMonth, props]);

  useEffect(() => {
    if (layout !== "mobile") {
      handleInitialDateSelection();
    }
  }, [handleInitialDateSelection, layout]);

  // Track if the previous week was unavailable
  let wasPreviousWeekUnavailable = false;

  return (
    <>
      {weeks.map((week, weekIndex) => {
        // Find the index where the transition between months occurs
        const transitionIndex = week.findIndex(
          ({ day }) => day?.date() === 1 && day?.month() === browsingDate.add(1, "month").month()
        );
        // Check if this week contains the transition from current month to next month
        const isTransitionRow = transitionIndex !== -1;
        const isUnavailableWeek = week.every(({ disabled }) => disabled);

        // Render "No Availability" if this week is unavailable and the previous week was available
        if (shouldRenderNextMonth && isUnavailableWeek && !isTransitionRow) {
          if (!wasPreviousWeekUnavailable) {
            wasPreviousWeekUnavailable = true;
            return (
              <div key={`week-${weekIndex}`} className="text-muted col-span-7 p-4 text-center text-sm">
                No availability
              </div>
            );
          } else {
            // Skip rendering consecutive "No Availability" divs
            wasPreviousWeekUnavailable = true;
            return null;
          }
        } else {
          // Reset the flag if this week is available
          wasPreviousWeekUnavailable = false;
        }

        return (
          <div key={`row-${weekIndex}`} className="relative contents">
            {week.map(({ day, disabled }, idx) => {
              return (
                <div
                  key={day === null ? `e-${idx}` : `day-${day.format()}`}
                  className="relative w-full pt-[100%]">
                  {day === null ? (
                    <div key={`e-${idx}`} />
                  ) : props.isPending ? (
                    <button
                      className="bg-muted text-muted absolute bottom-0 left-0 right-0 top-0 mx-auto flex w-full items-center justify-center rounded-sm border-transparent text-center font-medium opacity-50"
                      key={`e-${idx}`}
                      disabled>
                      <SkeletonText className="h-4 w-5" />
                    </button>
                  ) : (
                    <DayComponent
                      date={day}
                      onClick={() => {
                        const dayIsInNextMonth = day?.month() === browsingDate.add(1, "month").month();
                        props.onChange(day, dayIsInNextMonth);
                      }}
                      disabled={disabled}
                      active={isActive(day)}
                    />
                  )}

                  {/* Render a continuous separator line for the transition row */}
                  {isTransitionRow && shouldRenderNextMonth && (
                    <>
                      {idx === transitionIndex && (
                        <>
                          <div className="absolute left-[-3px] right-[-3px] top-[-3px] h-[2px] bg-gray-300" />
                          {idx !== 0 && (
                            <div className="absolute left-[-3px] top-[-1px] h-[104%] w-[2px] bg-gray-300" />
                          )}
                          {idx === 0 && (
                            <div className="text-white-700 absolute left-[-3px] top-[2px] text-xs">
                              {browsingDate.add(1, "month").format("MMMM")}
                            </div>
                          )}
                        </>
                      )}
                      {idx < transitionIndex && (
                        <div className="relative">
                          <div className="absolute bottom-[-3px] left-[-3px] right-[-3px] h-[2px] bg-gray-300" />
                          {idx === 0 && (
                            <div className="text-white-700 absolute left-[-3px] top-[2px] text-xs">
                              {browsingDate.add(1, "month").format("MMMM")}
                            </div>
                          )}
                        </div>
                      )}
                      {idx > transitionIndex && (
                        <>
                          <div className="absolute left-[-3px] right-[-3px] top-[-3px] h-[2px] bg-gray-300" />
                        </>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      {!props.isPending && includedDatesInMonth?.length === 0 && (
        <NoAvailabilityOverlay month={month} nextMonthButton={nextMonthButton} />
      )}
    </>
  );
};

const DatePicker = ({
  weekStart = 0,
  className,
  locale,
  selected,
  onMonthChange,
  showOneMonth,
  ...passThroughProps
}: DatePickerProps & Partial<React.ComponentProps<typeof Days>>) => {
  const [autoNavigating, setAutoNavigating] = useState(true); // Track automatic navigation
  const browsingDate = passThroughProps.browsingDate || dayjs().startOf("month");
  const nextMonthBrowsingDate = browsingDate.add(1, "month");
  const { i18n } = useLocale();

  const { shouldRenderNextMonth, includedDatesInMonth, includedDatesNextMonth } = useCalendarDays({
    browsingDate,
    weekStart,
    minDate: passThroughProps.minDate,
    excludedDates: passThroughProps.excludedDates,
    includedDates: passThroughProps.includedDates,
    showOneMonth,
  });

  const changeMonth = useCallback(
    (newMonth: number) => {
      setAutoNavigating(false); // Disable auto-navigation on manual action
      if (onMonthChange) {
        onMonthChange(browsingDate.add(newMonth, "month"));
      }
    },
    [browsingDate, onMonthChange]
  );
  const month = browsingDate
    ? new Intl.DateTimeFormat(i18n.language, { month: "long" }).format(
        new Date(browsingDate.year(), browsingDate.month())
      )
    : null;

  const nextMonth = new Intl.DateTimeFormat(i18n.language, { month: "long" }).format(
    new Date(nextMonthBrowsingDate.year(), nextMonthBrowsingDate.month())
  );

  const hasSameYear = browsingDate.format("YYYY") === nextMonthBrowsingDate.format("YYYY");
  const monthText = useMemo(() => {
    if (shouldRenderNextMonth) {
      if (hasSameYear) {
        return (
          <>
            <strong className="text-emphasis font-semibold">
              {month} / {nextMonth}
            </strong>{" "}
            <span className="text-subtle font-medium">{browsingDate.format("YYYY")}</span>
          </>
        );
      }
      return (
        <div className="flex">
          <strong className="text-emphasis mr-1 font-semibold">{month}</strong>
          <span className="text-subtle font-medium">{browsingDate.format("YYYY")}</span>
          <strong className="text-emphasis mx-1 font-semibold">/</strong>
          <strong className="text-emphasis  mr-1 font-semibold">{nextMonth}</strong>
          <span className="text-subtle font-medium">{nextMonthBrowsingDate.format("YYYY")}</span>
        </div>
      );
    }
    return (
      <>
        <strong className="text-emphasis font-semibold">{month}</strong>{" "}
        <span className="text-subtle font-medium">{browsingDate.format("YYYY")}</span>
      </>
    );
  }, [browsingDate, hasSameYear, month, nextMonth, nextMonthBrowsingDate, shouldRenderNextMonth]);

  // Effect to auto-navigate when no dates are available in the current month
  useEffect(() => {
    if (autoNavigating && includedDatesInMonth?.length === 0 && includedDatesNextMonth?.length > 0) {
      changeMonth(+1);
    } else {
      setAutoNavigating(false); // Reset the flag after the navigation is complete
    }
  }, [changeMonth, includedDatesInMonth?.length, includedDatesNextMonth?.length, autoNavigating]);

  return (
    <div className={className}>
      <div className="mb-1 flex items-center justify-center text-xl">
        <div className="text-emphasis">
          <div className="flex items-center justify-center">
            <Button
              className={classNames(
                "group p-1 opacity-70 hover:opacity-100 rtl:rotate-180",
                !browsingDate.isAfter(dayjs()) &&
                  "disabled:text-bookinglighter hover:bg-background hover:opacity-70"
              )}
              onClick={() => changeMonth(-1)}
              disabled={!browsingDate.isAfter(dayjs())}
              data-testid="decrementMonth"
              color="minimal"
              variant="icon"
              StartIcon={ChevronLeft}
            />
            <div className="text-default mx-4 text-base">
              {browsingDate ? monthText : <SkeletonText className="h-8 w-24" />}
            </div>
            <Button
              className="group p-1 opacity-70 hover:opacity-100 rtl:rotate-180"
              onClick={() => changeMonth(+1)}
              data-testid="incrementMonth"
              color="minimal"
              variant="icon"
              StartIcon={ChevronRight}
            />
          </div>
        </div>
      </div>
      <div className="border-subtle mb-2 grid grid-cols-7 gap-4 border-b border-t text-center md:mb-0 md:border-0">
        {weekdayNames(locale, weekStart, "short").map((weekDay) => (
          <div key={weekDay} className="text-emphasis my-4 text-xs font-medium uppercase tracking-widest">
            {weekDay}
          </div>
        ))}
      </div>
      <div className="relative grid grid-cols-7 gap-1 text-center">
        <Days
          weekStart={weekStart}
          selected={selected}
          {...passThroughProps}
          browsingDate={browsingDate}
          month={month}
          nextMonthButton={() => changeMonth(+1)}
          showOneMonth={showOneMonth}
        />
      </div>
    </div>
  );
};

export default DatePicker;
