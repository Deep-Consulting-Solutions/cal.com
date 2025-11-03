interface SetupCalendarOauthEmailProps {
  url: string;
  userName: string;
  providerName?: string;
}

export function setupCalendarOauthEmail({
  url,
  userName,
  providerName = "Calendar",
}: SetupCalendarOauthEmailProps): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>${providerName} Setup</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        .container {
          background-color: #f4f4f4;
          border-radius: 5px;
          padding: 20px;
        }
        .button {
          display: inline-block;
          background-color: #007bff;
          color: white !important;
          padding: 12px 24px;
          text-decoration: none;
          border-radius: 5px;
          margin: 20px 0;
        }
        .urgent {
          color: #d32f2f;
          font-weight: bold;
        }
        .footer {
          margin-top: 30px;
          padding-top: 20px;
          border-top: 1px solid #ddd;
          font-size: 12px;
          color: #666;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h2>Complete Your ${providerName} Setup</h2>

        <p>Hi ${userName},</p>

        <p class="urgent">⚠️ This is an urgent action required to complete your scheduling setup.</p>

        <p>To enable calendar integration and complete your setup, please click the button below to connect your ${providerName}:</p>

        <a href="${url}" class="button">Connect ${providerName}</a>

        <p><strong>Why is this important?</strong></p>
        <ul>
          <li>Enables automatic calendar synchronization</li>
          <li>Allows you to host and manage meetings</li>
          <li>Prevents double-booking across your calendars</li>
        </ul>

        <p>If the button doesn't work, copy and paste this link into your browser:</p>
        <p style="word-break: break-all; background-color: #f0f0f0; padding: 10px; border-radius: 3px;">
          ${url}
        </p>

        <div class="footer">
          <p>This email was sent because an administrator has set up a scheduling account for you.</p>
          <p>If you have any questions, please contact your system administrator.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

// For backward compatibility
export function setupZohoCalenderOauthEmail({ url }: { url: string }): string {
  return setupCalendarOauthEmail({
    url,
    userName: "User",
    providerName: "Zoho Calendar",
  });
}
