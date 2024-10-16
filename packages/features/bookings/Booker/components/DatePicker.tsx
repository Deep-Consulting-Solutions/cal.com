import { useState } from "react";
import { shallow } from "zustand/shallow";

import type { Dayjs } from "@calcom/dayjs";
import dayjs from "@calcom/dayjs";
import { default as DatePickerComponent } from "@calcom/features/calendars/DatePicker";
import { useNonEmptyScheduleDays } from "@calcom/features/schedules";
import { weekdayToWeekIndex } from "@calcom/lib/date-fns";
import { useLocale } from "@calcom/lib/hooks/useLocale";

import { useBookerStore } from "../store";
import type { useEventReturnType, useScheduleForEventReturnType } from "../utils/event";

export const DatePicker = ({
  event,
  schedule,
}: {
  event: useEventReturnType;
  schedule: useScheduleForEventReturnType;
}) => {
  const [showOneMonth, setShowOneMonth] = useState(false);
  const { i18n } = useLocale();
  const [month, selectedDate] = useBookerStore((state) => [state.month, state.selectedDate], shallow);
  const layout = useBookerStore((state) => state.layout, shallow);
  const [setSelectedDate, setMonth, setDayCount] = useBookerStore(
    (state) => [state.setSelectedDate, state.setMonth, state.setDayCount],
    shallow
  );
  const nonEmptyScheduleDays = useNonEmptyScheduleDays(schedule?.data?.slots);

  return (
    <DatePickerComponent
      isPending={schedule.isPending}
      onChange={(date: Dayjs | null, showOneMonth?: boolean) => {
        if (showOneMonth) {
          setShowOneMonth(true);
        }
        setSelectedDate(date === null ? date : date.format("YYYY-MM-DD"));
      }}
      onMonthChange={(date: Dayjs) => {
        setShowOneMonth(false);
        setMonth(date.format("YYYY-MM"));
        setDayCount(null); // Whenever the month is changed, we nullify getting X days
        if (layout !== "mobile") {
          setSelectedDate(date.format("YYYY-MM-DD"));
        }
      }}
      includedDates={nonEmptyScheduleDays}
      locale={i18n.language}
      browsingDate={month ? dayjs(month) : undefined}
      selected={dayjs(selectedDate)}
      weekStart={weekdayToWeekIndex(event?.data?.users?.[0]?.weekStart)}
      showOneMonth={showOneMonth}
    />
  );
};
