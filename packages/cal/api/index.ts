import type { NextApiRequest, NextApiResponse } from "next";

export { default as apiKeys } from "./api-keys";
export { default as attendees } from "./attendees";
export { default as availabilities } from "./availabilities";
export { default as availability } from "./availability";
export { default as bookingReferences } from "./booking-references";
export { default as bookings } from "./bookings";
export { default as customInputs } from "./custom-inputs";
export { default as destinationCalendars } from "./destination-calendars";
export { default as eventTypes } from "./event-types";
export { default as invites } from "./invites";
export { default as me } from "./me";
export { default as memberships } from "./memberships";
export { default as payments } from "./payments";
export { default as schedules } from "./schedules";
export { default as selectedCalendars } from "./selected-calendars";
export { default as slots } from "./slots";
export { default as teams } from "./teams";
export { default as users } from "./users";
export { default as webhooks } from "./webhooks";

export default async function CalcomApi(_: NextApiRequest, res: NextApiResponse) {
  res.status(200).json({ message: "Welcome to Cal.com API - docs are at https://developer.cal.com/api" });
}
