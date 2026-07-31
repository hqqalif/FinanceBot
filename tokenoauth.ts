import { google } from "googleapis";
import http from "node:http";
import url from "node:url";
import fs from "node:fs/promises";
import path from "node:path";

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file",
];

async function authenticateUser() {
  const oauthPath = path.join(process.cwd(), "oauth-credentials.json");
  const keys = JSON.parse(await fs.readFile(oauthPath, "utf8"));
  
  // Handles both "installed" (Desktop) and "web" app credentials from Google Cloud
  const { client_id, client_secret } = keys.installed || keys.web;

  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    "http://localhost:3000/oauth2callback"
  );

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline", // Essential to get a refresh_token
    scope: SCOPES,
    prompt: "consent",      // Forces Google to return a refresh token every time
  });

  console.log("\n1. Open this URL in your browser:\n\n", authUrl, "\n");

  // Spin up a temporary local HTTP server to receive the callback code
  const server = http
    .createServer(async (req, res) => {
      if (req.url?.startsWith("/oauth2callback")) {
        const q = url.parse(req.url, true).query;
        const { tokens } = await oAuth2Client.getToken(q.code as string);

        // Save tokens to token.json in root directory
        await fs.writeFile(
          path.join(process.cwd(), "token.json"),
          JSON.stringify(tokens, null, 2)
        );

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<h1>Authentication Successful!</h1><p>You can close this tab now and return to your terminal.</p>");
        
        console.log("SUCCESS: token.json has been created in your project root!");
        server.close();
        process.exit(0);
      }
    })
    .listen(3000);
}

authenticateUser();