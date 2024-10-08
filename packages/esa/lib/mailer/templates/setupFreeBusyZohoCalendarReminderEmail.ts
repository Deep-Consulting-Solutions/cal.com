export default function setupFreeBusyZohoCalendarReminderEmail(data: Record<string, unknown>) {
  return `
<p>Reminder to setup free busy on your zoho calendar<p/>
<p>Calendar: ${data.calendarName}</p>
`;
}
