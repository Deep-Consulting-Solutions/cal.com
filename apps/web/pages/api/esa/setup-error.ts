import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Public endpoint - no authentication required
  // Error page for failed managed calendar setup

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Setup Failed</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          margin: 0;
          background: linear-gradient(135deg, #f5576c 0%, #d32f2f 100%);
        }
        .container {
          background: white;
          border-radius: 12px;
          padding: 48px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          text-align: center;
          max-width: 600px;
        }
        .error-icon {
          width: 80px;
          height: 80px;
          border-radius: 50%;
          display: block;
          margin: 0 auto 24px;
          background: #ffebee;
          position: relative;
        }
        .error-icon::before,
        .error-icon::after {
          content: '';
          position: absolute;
          background: #d32f2f;
          width: 4px;
          height: 40px;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%) rotate(45deg);
        }
        .error-icon::after {
          transform: translate(-50%, -50%) rotate(-45deg);
        }
        h1 {
          color: #d32f2f;
          font-size: 32px;
          font-weight: 600;
          margin: 0 0 16px;
        }
        p {
          color: #666;
          font-size: 16px;
          line-height: 1.6;
          margin: 0 0 16px;
        }
        .instructions {
          background: #f5f5f5;
          border-left: 4px solid #d32f2f;
          padding: 20px;
          margin: 24px 0;
          text-align: left;
        }
        .instructions h2 {
          color: #333;
          font-size: 18px;
          margin: 0 0 12px;
        }
        .instructions ol {
          margin: 0;
          padding-left: 20px;
        }
        .instructions li {
          margin-bottom: 8px;
          color: #555;
        }
        .contact {
          margin-top: 24px;
          padding-top: 20px;
          border-top: 1px solid #ddd;
          font-size: 14px;
          color: #999;
        }
        .contact strong {
          color: #666;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="error-icon"></div>
        <h1>Calendar Setup Failed</h1>
        <p>Unfortunately, there was an error connecting your Microsoft Outlook calendar.</p>

        <div class="instructions">
          <h2>What to do next:</h2>
          <ol>
            <li><strong>Try again:</strong> Go back to the original email you received and click the setup link again.</li>
            <li><strong>Check your email:</strong> Make sure you're using the Microsoft account associated with your work email.</li>
            <li><strong>Grant all permissions:</strong> When prompted, make sure to accept all requested calendar permissions.</li>
          </ol>
        </div>

        <div class="instructions">
          <h2>If the problem persists:</h2>
          <ol>
            <li>Contact your system administrator for assistance.</li>
            <li>Provide them with the time of this error: <strong>${new Date().toISOString()}</strong></li>
          </ol>
        </div>

        <div class="contact">
          <p>You may close this window.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  res.setHeader("Content-Type", "text/html");
  res.status(200).send(html);
}
