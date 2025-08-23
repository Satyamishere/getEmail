import { google } from "googleapis";
import User from "../models/user.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import axios from "axios";
// @ts-nocheck

const isSame = (a, b) => {
  if (a.length !== b.length) return false;
  return a.every((val, idx) => {
    return val === b[idx];
  });
};

const createoauth2obj = () => {
  const oauth2UserObj = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  return oauth2UserObj;
};
const generateAcessandRefreshToken = (email) => {
  const payload = { email };
  const accessSecret = process.env.ACCESS_TOKEN_KEY;
  const refreshSecret = process.env.REFRESH_TOKEN_KEY;
  const accessExpiry = process.env.ACCESS_TOKEN_EXPIRY;
  const refreshExpiry = process.env.REFRESH_TOKEN_EXPIRY;

  if (!accessSecret || !refreshSecret) {
    throw new Error('JWT secret keys are missing. Please set ACCESS_TOKEN_KEY and REFRESH_TOKEN_KEY in your environment variables.');
  }

  const accessNotGoogleToken = jwt.sign(payload, accessSecret, { expiresIn: accessExpiry });
  const refreshNotGoogleToken = jwt.sign(payload, refreshSecret, { expiresIn: refreshExpiry });
  return { accessNotGoogleToken, refreshNotGoogleToken };
};
const login = async (req, res) => {
  const scopes = [
    "https://mail.google.com/",
    "https://www.googleapis.com/auth/spreadsheets",
    "openid",
    "email",
    "profile"
  ];
  const oauth2UserObj = createoauth2obj();
  const url = oauth2UserObj.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: scopes,
  });
  return res.redirect(url);
};

const callback = async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) {
      console.error('No code received in callback');
      return res.status(400).send('Missing code parameter in callback');
    }
    const oauth2UserObj = createoauth2obj();
    const { tokens } = await oauth2UserObj.getToken(code);
    if (!tokens || !tokens.access_token) {
      console.error('No tokens received from Google:', tokens);
      return res.status(400).send('Failed to exchange code for tokens');
    }
    oauth2UserObj.setCredentials(tokens);
    const objToInteractWithMail = google.oauth2({
      auth: oauth2UserObj,
      version: "v2",
    });
    const { data } = await objToInteractWithMail.userinfo.get();
    // sign the email for use as middleware
    const { accessNotGoogleToken, refreshNotGoogleToken } = generateAcessandRefreshToken(data.email);
    let user = await User.findOne({ email: data.email });
    if (!user) {
      user = await User.create({
        email: data.email,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
      });
    } else {
      // Update tokens for existing user
      user.accessToken = tokens.access_token;
      user.refreshToken = tokens.refresh_token;
      await user.save();
    }
    req.user = data;
    // Redirect back to frontend with our internal tokens as query params (quick dev flow).
    const frontendBase = process.env.FRONTEND_URL || "http://localhost:5173";
    const redirectUrl = `${frontendBase}/?access=${encodeURIComponent(
      accessNotGoogleToken
    )}&refresh=${encodeURIComponent(refreshNotGoogleToken)}&email=${encodeURIComponent(
      data.email
    )}`;
    return res.redirect(redirectUrl);
  } catch (error) {
    console.error('Callback error:', error);
    return res.status(500).send(`not authenticated exact error: ${error.message}`);
  }
};

const searchmail = async (req, res) => {
  try {
    const arr = [];
  const { filters } = req.body || {};
    // tolerate user entering the sender email in the subject field by mistake
    let fromInput = filters?.from?.toString().trim();
    let subjectInput = filters?.subject?.toString().trim();


    // if (!fromInput && subjectInput && subjectInput.includes('@')) {
    //   // assume they meant to put the sender in the email field
    //   fromInput = subjectInput;
    //   subjectInput = '';
    // }



    if (fromInput) {
      arr.push(`from:${fromInput}`);
    }
    if (subjectInput) {
      arr.push(`subject:${subjectInput}`);
    }
    const q = arr.join(" ");
    // Allow caller to optionally specify which saved mailbox to query.
    // If not provided, default to the authenticated user's email.
    const targetEmail = (filters && filters.accountEmail) ? filters.accountEmail.toString().trim() : req.user.email;

  // Authorization rule: caller must be querying their own saved mailbox, or be an admin set via ADMIN_EMAIL in env.
  // Defensive access: make sure req.user exists and provide a fallback so we don't throw if callerEmail is removed.
  const callerEmail = req.user?.email;
    // const adminEmail = process.env.ADMIN_EMAIL;
    // if (targetEmail !== callerEmail && callerEmail !== adminEmail) {
    //   return res.status(403).json({ message: 'Forbidden: you may only query your own mailbox unless you are the configured admin.' });
    // }

    const user = await User.findOne({ email: targetEmail });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    // Set up Gmail client
    const oauth2UserObj = createoauth2obj();
    oauth2UserObj.setCredentials({
      access_token: user.accessToken,
      refresh_token: user.refreshToken,
    });
    const gmail = google.gmail({ version: "v1", auth: oauth2UserObj });

  // Call Gmail API
    let messages;
    try {
      messages = await gmail.users.messages.list({ userId: "me", q: q });
    } catch (gmailErr) {
      console.error('Gmail API list error:', gmailErr?.message || gmailErr);
      // Re-throw so outer catch returns a 500 with the message (and it will be logged)
      throw new Error(`GMAIL_API_LIST_ERROR: ${gmailErr?.message || gmailErr}`);
    }
    if (!messages?.data?.messages) {
      return res.status(404).json({ message: "No messages found" });
    }
    const messageDetails = await Promise.all(
      messages.data.messages.map(async (message) => {
        try {
          const msg = await gmail.users.messages.get({
            userId: "me",
            id: message.id,
            format: "metadata",
            metadataHeaders: ["from", "subject", "date"],
          });
          return {
            id: message.id,
            from: msg.data.payload.headers.find((h) => h.name === "From").value,
            subject: msg.data.payload.headers.find((h) => h.name === "Subject")?.value || "",
            date: msg.data.payload.headers.find((h) => h.name === "Date")?.value || "",
            snippet: msg.data.snippet || "",
          };
        } catch (msgErr) {
          console.error(`Gmail message.get error id=${message.id}:`, msgErr?.message || msgErr);
          // skip this message but continue
          return { id: message.id, from: '', subject: '', date: '', snippet: '' };
        }
      })
    );
    // Try to write to Google Sheets and send Slack notifications, but do not fail the whole request
    // if those auxiliary operations fail (for example missing Sheets scope in the OAuth token).
    try {
      const sheets = google.sheets({ version: "v4", auth: oauth2UserObj });
      const spreadsheetId = process.env.GOOGLE_SHEET_ID; // optional
      if (spreadsheetId) {
        const range = "Sheet1!A1";
        // Prepare data for sheets
        const values = messageDetails.map((msg) => [msg.date || "", msg.from || "", msg.subject || "", msg.snippet || ""]);
        // First, check if the sheet has data
        const headerCheck = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Sheet1!A1:D1" });
        let check_arr = ["Date", "From", "Subject", "Content"];
        if (!headerCheck.data.values || !isSame(headerCheck.data.values[0], check_arr)) {
          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: "Sheet1!A1:D1",
            valueInputOption: "RAW",
            resource: { values: [["Date", "From", "Subject", "Content"]] },
          });
        }
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: "Sheet1!A2:D",
          valueInputOption: "RAW",
          insertDataOption: "INSERT_ROWS",
          resource: { values },
        });
      }
      // Slack is optional as well
      if (process.env.SLACK_WEBHOOK_URL) {
        const slackMessage = {
          text: `📬 ${messageDetails.length} new emails filtered`,
          attachments: messageDetails.map((msg) => ({
            color: "#36a64f",
            fields: [
              { title: "From", value: msg.from, short: true },
              { title: "Subject", value: msg.subject, short: true },
              { title: "Date", value: msg.date, short: true },
              { title: "Snippet", value: msg.snippet, short: false },
            ],
            footer: `<https://mail.google.com/mail/u/0/#inbox/${msg.id}|View in Gmail>`,
          })),
        };
        await axios.post(process.env.SLACK_WEBHOOK_URL, slackMessage).catch((err) => {
          console.error(`slack error: ${err.message}`);
        });
      }
    } catch (auxErr) {
      console.error('Auxiliary operation (Sheets/Slack) failed, continuing:', auxErr.message);
      // don't fail the main request because of sheet/slack issues
    }

    return res.status(200).json({
      message: "fetched messages",
      count: messageDetails.length,
      messages: messageDetails,
    });
  } catch (error) {
    //console.error("Error in searchmail:", error);
    return res.status(500).json({
      message: "Error fetching emails",
      error: error.message,
    });
  }
  }
export {login,callback,searchmail}
