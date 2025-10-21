import { google } from "googleapis";
import User from "../models/user.js";
import jwt from "jsonwebtoken";

import axios from "axios";
import cron from 'node-cron';
// @ts-nocheck


const latestMessages = new Map();
const cronRegistry = new Map();

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
    // set secure HttpOnly cookie so navigator.sendBeacon and browser requests include it
    try {
      res.cookie('accessNotGoogleToken', accessNotGoogleToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'Lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      });
    } catch (cookieErr) {
      
      console.error('Failed to set cookie on callback:', cookieErr?.message || cookieErr);
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
    console.log('[searchmail] invoked by', req.user?.email);
    const arr = [];
  const { filters } = req.body || {};
    // tolerate user entering the sender email in the subject field by mistake
    let fromInput = filters?.from?.toString().trim();
    let subjectInput = filters?.subject?.toString().trim();


    



    if (fromInput) {
      arr.push(`from:${fromInput}`);
    }
    if (subjectInput) {
      arr.push(`subject:${subjectInput}`);
    }
    const q = arr.join(" ");
    
    //here req.user.email is the authenticated email we set in req during middleware.we used this targetmail to find the saved authenticated mail and obatin the keys for oauthobj thats the main goal
    const targetEmail = (filters && filters.accountEmail) ? filters.accountEmail.toString().trim() : req.user.email;

  
  

    const user = await User.findOne({ email: targetEmail });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    // Set up Gmail client using the tokens from authenticated gmail we saved in our database
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
      
      if (process.env.SLACK_WEBHOOK_URL) {
        const slackMessage = {
          text: ` ${messageDetails.length} new emails filtered`,
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
      
    }

    
    
    
    
    
    try {
      latestMessages.set(targetEmail, messageDetails);
    } catch (e) { console.error('cache store err', e?.message || e); }

    // start per-user cron every 10s
    
    
    let scheduled = false;
    try {
      if (!cronRegistry.has(targetEmail)) {
        const task = cron.schedule('*/10 * * * * *', async () => {
          try {
            const up = await User.findOne({ email: targetEmail });
            if (!up) return; // user removed
            const oauth2 = createoauth2obj();
            oauth2.setCredentials({ access_token: up.accessToken, refresh_token: up.refreshToken });
            const g = google.gmail({ version: 'v1', auth: oauth2 });
            const lr = await g.users.messages.list({ userId: 'me', q });
            const fetched = [];
            const msgs = lr?.data?.messages || [];
            for (const mm of msgs.slice(0, 10)) {
              try {
                const mget = await g.users.messages.get({ userId: 'me', id: mm.id, format: 'metadata', metadataHeaders: ['from','subject','date'] });
                const headers = mget.data.payload.headers || [];
                fetched.push({
                  id: mm.id,
                  from: headers.find(h => h.name === 'From')?.value || '',
                  subject: headers.find(h => h.name === 'Subject')?.value || '',
                  date: headers.find(h => h.name === 'Date')?.value || '',
                  snippet: mget.data.snippet || '',
                });
              } catch (e) { /* ignore per-message errors */ }
            }
            // update cache
            try {
              latestMessages.set(targetEmail, fetched);
            } catch (e) { /* ignore */ }
            console.log(`[cron] polled ${targetEmail}: ${fetched.length}`);
          } catch (e) {
            console.error('[cron] err', e?.message || e);
           
            const t = cronRegistry.get(targetEmail);
            if (t) { try { t.stop(); } catch (er) {} }
            cronRegistry.delete(targetEmail);
          }
        });
        cronRegistry.set(targetEmail, task);
        
        scheduled = true;
      }
    } catch (e) { console.error('scheduling err', e?.message || e); }





    return res.status(200).json({
      message: "fetched messages",
      count: messageDetails.length,
      messages: messageDetails,
      scheduled,
    });
  } catch (error) {
    
    return res.status(500).json({
      message: "Error fetching emails",
      error: error.message,
    });
  }
  }
// Stop cron for an email 
function stopPollingForEmail(email) {
  try {
    if (!cronRegistry) return false;
    const t = cronRegistry.get(email);
    if (t) {
      try { t.stop(); } catch (e) {}
      cronRegistry.delete(email);
    }
    latestMessages.delete(email);
    console.log('[cron] stopped', email);
    return true;
  } catch (e) { return false; }
}

// Express handler: return latest cached messages for authenticated user
const getLatestMessages = async (req, res) => {
  try {
    const email = req.user?.email;
    if (!email) return res.status(400).json({ message: 'missing user' });
    const msgs = latestMessages.get(email) || [];
    return res.json({ messages: msgs });
  } catch (e) { return res.status(500).json({ message: 'error' }); }
};

// Debug/status handler: return whether a cron is running for this user and the cached messages
const getPollStatus = async (req, res) => {
  try {
    const email = req.user?.email;
    if (!email) return res.status(400).json({ message: 'missing user' });
    const polling = cronRegistry.has(email);
    const msgs = latestMessages.get(email) || [];
    return res.json({ polling, count: msgs.length, messages: msgs });
  } catch (e) { return res.status(500).json({ message: 'error' }); }
};


const stopPolling = async (req, res) => {
  try {
    const email = req.user?.email;
    if (!email) return res.status(400).json({ message: 'missing user' });
    const stopped = stopPollingForEmail(email);
    return res.json({ stopped });
  } catch (e) { return res.status(500).json({ message: 'error' }); }
};

export {login,callback,searchmail,stopPollingForEmail,getLatestMessages,getPollStatus,stopPolling}
