import { useCallback } from "react";
import { shallow } from "zustand/shallow";

import type { Dayjs } from "@calcom/dayjs";
import dayjs from "@calcom/dayjs";
import { default as DatePickerComponent } from "@calcom/features/calendars/DatePicker";
import { useNonEmptyScheduleDays } from "@calcom/features/schedules";
import { weekdayToWeekIndex } from "@calcom/lib/date-fns";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { BookerLayouts } from "@calcom/prisma/zod-utils";

import { useBookerStore } from "../store";
import type { useEventReturnType, useScheduleForEventReturnType } from "../utils/event";

export const DatePicker = ({
  event,
  schedule,
}: {
  event: useEventReturnType;
  schedule: useScheduleForEventReturnType;
}) => {
  const { i18n } = useLocale();
  const [month, selectedDate] = useBookerStore((state) => [state.month, state.selectedDate], shallow);
  const layout = useBookerStore((state) => state.layout, shallow);
  const [setSelectedDate, setMonth, setDayCount] = useBookerStore(
    (state) => [state.setSelectedDate, state.setMonth, state.setDayCount],
    shallow
  );
  const nonEmptyScheduleDays = useNonEmptyScheduleDays(schedule?.data?.slots);

  const handleMonthChange = useCallback(
    (date: Dayjs) => {
      const newMonth = date.format("YYYY-MM");
      if (newMonth === month) return;

      setMonth(newMonth);
      setDayCount(null);

      if (layout === BookerLayouts.COLUMN_VIEW || layout === BookerLayouts.WEEK_VIEW) {
        const newSelectedDate = date.format("YYYY-MM-DD");
        if (newSelectedDate !== selectedDate) {
          setSelectedDate(newSelectedDate);
        }
      }
    },
    [month, layout, setDayCount, setMonth, selectedDate, setSelectedDate]
  );

  return (
    <DatePickerComponent
      isPending={schedule.isPending}
      onChange={(date: Dayjs | null) => {
        setSelectedDate(date === null ? date : date.format("YYYY-MM-DD"));
      }}
      onMonthChange={handleMonthChange}
      includedDates={nonEmptyScheduleDays}
      locale={i18n.language}
      browsingDate={month ? dayjs(month) : undefined}
      selected={dayjs(selectedDate)}
      weekStart={weekdayToWeekIndex(event?.data?.users?.[0]?.weekStart)}
      showOneMonth={false}
    />
  );
};
