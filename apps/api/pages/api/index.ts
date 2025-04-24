import type { NextApiRequest, NextApiResponse } from "next";

export { default as eventTypes } from "./event-types";
export { default as schedules } from "./schedules";
export { default as availabilities } from "./availabilities";
export { default as availability } from "./availability";
export { default as bookingReferences } from "./booking-references";
export { default as bookings } from "./bookings";
export { default as schedules } from "./schedules";
export { default as slots } from "./slots";
export { default as teams } from "./teams";

export default async function CalcomApi(_: NextApiRequest, res: NextApiResponse) {
  res.status(200).json({ message: "Welcome to Cal.com API - docs are at https://developer.cal.com/api" });
}
