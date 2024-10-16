import type { TFunction } from "next-i18next";
import { Trans } from "next-i18next";
import Link from "next/link";
import { useEffect, useState, useMemo } from "react";
import type { FieldError } from "react-hook-form";

import { WEBSITE_URL } from "@calcom/lib/constants";
import getPaymentAppData from "@calcom/lib/getPaymentAppData";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { Alert, Button, EmptyScreen, Form } from "@calcom/ui";
import { Calendar } from "@calcom/ui/components/icon";

import { useBookerStore } from "../../store";
import type { useEventReturnType } from "../../utils/event";
import type { UseBookingFormReturnType } from "../hooks/useBookingForm";
import type { IUseBookingErrors, IUseBookingLoadingStates } from "../hooks/useBookings";
import { BookingFields } from "./BookingFields";
import { FormSkeleton } from "./Skeleton";

type BookEventFormProps = {
  onCancel?: () => void;
  onSubmit: () => void;
  errorRef: React.RefObject<HTMLDivElement>;
  errors: UseBookingFormReturnType["errors"] & IUseBookingErrors;
  loadingStates: IUseBookingLoadingStates;
  children?: React.ReactNode;
  bookingForm: UseBookingFormReturnType["bookingForm"];
  renderConfirmNotVerifyEmailButtonCond: boolean;
  extraOptions: Record<string, string | string[]>;
  hidePrivacy?: boolean;
  hideBackButton?: boolean;
};

export const BookEventForm = ({
  onCancel,
  eventQuery,
  rescheduleUid,
  onSubmit,
  errorRef,
  errors,
  loadingStates,
  renderConfirmNotVerifyEmailButtonCond,
  bookingForm,
  children,
  extraOptions,
  hidePrivacy = true,
  hideBackButton = true,
}: Omit<BookEventFormProps, "event"> & {
  eventQuery: useEventReturnType;
  rescheduleUid: string | null;
}) => {
  const eventType = eventQuery.data;
  const setFormValues = useBookerStore((state) => state.setFormValues);
  const bookingData = useBookerStore((state) => state.bookingData);
  const timeslot = useBookerStore((state) => state.selectedTimeslot);
  const username = useBookerStore((state) => state.username);
  const isInstantMeeting = useBookerStore((state) => state.isInstantMeeting);
  const [isPhoneModified, setIsPhoneModified] = useState(false);
  // const [expiryTime, setExpiryTime] = useState<Date | undefined>();

  const [responseVercelIdHeader] = useState<string | null>(null);
  const { t } = useLocale();

  useEffect(() => {
    // This is a hack to make sure that the phone number is always in the correct format
    if (!isPhoneModified) {
      const values: any = bookingForm.getValues();
      if (values.responses?.phone) {
        const phone = values.responses.phone;
        if (phone.length > 0 && phone[0] !== "+") {
          values.responses.phone = `+${phone}`;
          setFormValues(values);
        }
        setIsPhoneModified(true);
      }
      if (values.responses?.smsReminderNumber) {
        const smsPhone = values.responses.smsReminderNumber;
        if (smsPhone.length > 0 && smsPhone[0] !== "+") {
          values.responses.smsReminderNumber = `+${smsPhone}`;
          setFormValues(values);
        }
      }
      if (values.responses?.sms) {
        const smsPhone = values.responses.sms;
        if (smsPhone.length > 0 && smsPhone[0] !== "+") {
          values.responses.sms = `+${smsPhone}`;
          setFormValues(values);
        }
      }
      if (values.responses?.location) {
        const location = values.responses.location;
        const optionValue = location.optionValue;
        if (optionValue && optionValue.length && optionValue[0] !== "+" && /^[^a-zA-Z]*$/.test(optionValue)) {
          values.responses.location.optionValue = `+${optionValue}`;
          setFormValues(values);
        }
        if (location.value === "phone" && !location.optionValue) {
          const phone = values.responses?.phone || "";
          values.responses.location.optionValue = `+${phone}`;
          setFormValues(values);
        }
      }
    }
  }, [bookingForm, isPhoneModified, setFormValues]);

  const isPaidEvent = useMemo(() => {
    if (!eventType?.price) return false;
    const paymentAppData = getPaymentAppData(eventType);
    return eventType?.price > 0 && !Number.isNaN(paymentAppData.price) && paymentAppData.price > 0;
  }, [eventType]);

  if (eventQuery.isError) return <Alert severity="warning" message={t("error_booking_event")} />;
  if (eventQuery.isPending || !eventQuery.data) return <FormSkeleton />;
  if (!timeslot)
    return (
      <EmptyScreen
        headline={t("timeslot_missing_title")}
        description={t("timeslot_missing_description")}
        Icon={Calendar}
        buttonText={t("timeslot_missing_cta")}
        buttonOnClick={onCancel}
      />
    );

  if (!eventType) {
    console.warn("No event type found for event", extraOptions);
    return <Alert severity="warning" message={t("error_booking_event")} />;
  }

  return (
    <div className="flex h-full flex-col">
      <p className="text-text mb-4 text-xl font-semibold">Enter Details</p>
      <Form
        className="flex flex-col" // Having h-full class is causing a layout issue in Safari
        onChange={() => {
          // Form data is saved in store. This way when user navigates back to
          // still change the timeslot, and comes back to the form, all their values
          // still exist. This gets cleared when the form is submitted.
          const values = bookingForm.getValues();
          setFormValues(values);
        }}
        form={bookingForm}
        handleSubmit={onSubmit}
        noValidate>
        <BookingFields
          isDynamicGroupBooking={!!(username && username.indexOf("+") > -1)}
          fields={eventType.bookingFields}
          locations={eventType.locations}
          rescheduleUid={rescheduleUid || undefined}
          bookingData={bookingData}
        />
        {(errors.hasFormErrors || errors.hasDataErrors) && (
          <div data-testid="booking-fail">
            <Alert
              ref={errorRef}
              className="my-2"
              severity="info"
              title={rescheduleUid ? t("reschedule_fail") : t("booking_fail")}
              message={getError(errors.formErrors, errors.dataErrors, t, responseVercelIdHeader)}
            />
          </div>
        )}
        {!hidePrivacy && (
          <div className="text-subtle my-3 w-full text-xs opacity-80">
            <Trans i18nKey="signing_up_terms">
              By proceeding, you agree to our{" "}
              <Link className="text-emphasis hover:underline" href={`${WEBSITE_URL}/terms`} target="_blank">
                <a>Terms</a>
              </Link>{" "}
              and{" "}
              <Link className="text-emphasis hover:underline" href={`${WEBSITE_URL}/privacy`} target="_blank">
                <a>Privacy Policy</a>
              </Link>
              .
            </Trans>
          </div>
        )}
        <div className="modalsticky mt-auto flex justify-end space-x-2 rtl:space-x-reverse">
          {isInstantMeeting ? (
            <Button type="submit" color="primary" loading={loadingStates.creatingInstantBooking}>
              {isPaidEvent ? t("pay_and_book") : t("confirm")}
            </Button>
          ) : (
            <>
              {!!onCancel && !hideBackButton && (
                <Button
                  color="minimal"
                  type="button"
                  onClick={onCancel}
                  className="rounded-[32px]"
                  data-testid="back">
                  {t("back")}
                </Button>
              )}
              <Button
                type="submit"
                color="primaryAlt"
                className="rounded-[32px]"
                loading={loadingStates.creatingBooking || loadingStates.creatingRecurringBooking}
                data-testid={
                  rescheduleUid && bookingData ? "confirm-reschedule-button" : "confirm-book-button"
                }>
                {rescheduleUid && bookingData
                  ? t("reschedule")
                  : renderConfirmNotVerifyEmailButtonCond
                  ? isPaidEvent
                    ? t("pay_and_book")
                    : t("confirm")
                  : t("verify_email_email_button")}
              </Button>
            </>
          )}
        </div>
      </Form>
      {children}
    </div>
  );
};

const getError = (
  globalError: FieldError | undefined,
  // It feels like an implementation detail to reimplement the types of useMutation here.
  // Since they don't matter for this function, I'd rather disable them then giving you
  // the cognitive overload of thinking to update them here when anything changes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dataError: any,
  t: TFunction,
  responseVercelIdHeader: string | null
) => {
  if (globalError) return globalError.message;

  const error = dataError;

  return error.message ? (
    <>
      {responseVercelIdHeader ?? ""} {t(error.message)}
    </>
  ) : (
    <>{t("can_you_try_again")}</>
  );
};
