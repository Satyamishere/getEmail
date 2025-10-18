import React, { useEffect, useState, useRef } from "react";
import axios from "axios";

// backend URL hard-coded inline below per request

function Home() {
  const [loggedInEmail, setLoggedInEmail] = useState("");
  // sender = the "from:" filter in Gmail query for your mailbox
  const [sender, setSender] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [message, setMessage] = useState("");
  const [messagesList, setMessagesList] = useState([]);

  // Parse tokens from URL on mount (Option A flow)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const access = params.get("access");
    const refresh = params.get("refresh");
    const emailParam = params.get("email");
    if (access) {
      // store tokens in localStorage for dev usage (not secure for production)
      localStorage.setItem("accessNotGoogleToken", access);
      if (refresh) localStorage.setItem("refreshNotGoogleToken", refresh);
      if (emailParam) setLoggedInEmail(emailParam);

      
      // Clean the URL so tokens don't stay in history
      const cleanUrl = window.location.origin + window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);
      setMessage("Authenticated — tokens saved (dev mode)");
    }
  }, []);


  // This useffect is for stopping cron on backend on unmount via refresh or navigate or clossing tab
  // we used sendbeacon instead of axios cause on unmount there is not enough time to do async fetch/axios/xhttp req so we use async beacon
  // closing page or refreshing dosnt count in unmountig so react doesnt call cleanup func thats why  we are usung beforeunlaod evenlistner as just before unmounting browser calls stopunload. The cleaup is used to remove the eventlistner
  useEffect(() => {
      const stopOnUnload = async () => {
        try {
          // We prefer relying on the server-set HttpOnly cookie for auth when available.
          // navigator.sendBeacon cannot set custom headers; for same-origin cookies this will include credentials.
          const url = 'http://localhost:4000/stopmails';
          const token = localStorage.getItem('accessNotGoogleToken');

          if (navigator.sendBeacon) {
            
            try { navigator.sendBeacon(url); } catch (e) { /* ignore */ }
            return;
          }

          // Fetch fallback for browsers/environments without sendBeacon support.
          // Use credentials: 'include' so cookies are sent when allowed by CORS and cookie attributes.
          const headers = { 'Content-Type': 'application/json' };
          if (token) headers['Authorization'] = `Bearer ${token}`;
          await fetch(url, { method: 'POST', keepalive: true, credentials: 'include', headers, body: token ? JSON.stringify({ token }) : undefined });
        } catch (e) {}
      };
    window.addEventListener('beforeunload', stopOnUnload);
    return () => window.removeEventListener('beforeunload', stopOnUnload);
  }, []);

  // Start backend cron once, then poll latestMessages every 10s to render
  const intervalRef = useRef(null);

  // fetchLatest is shared: used by the submit handler, manual refresh button, and the interval
  const fetchLatest = async () => {
    try {
      const token = localStorage.getItem('accessNotGoogleToken');
      if (!token) return console.log('[fetchLatest] no token');
      console.log('[fetchLatest] requesting latestMessages');
      const r = await axios.get('http://localhost:4000/latestMessages', { headers: { Authorization: `Bearer ${token}` } });
      console.log('[fetchLatest] got', (r.data && r.data.messages && r.data.messages.length) || 0);
      setMessagesList(r.data.messages || []);
    } catch (err) { console.error('[fetchLatest] err', err); }
  };

  useEffect(() => {
    return () => {
      // clear interval on unmount
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage('');
    try {
      const token = localStorage.getItem('accessNotGoogleToken');
      if (!token) { setMessage('No token found. Click Login first.'); return; }
      // start server-side polling
  await axios.post('http://localhost:4000/getmails', { filters: { from: sender || undefined, subject: subjectFilter || undefined } }, { headers: { Authorization: `Bearer ${token}` } });
      setMessage('Started polling on server.');
      // fetch immediately and then start interval
      await fetchLatest();
      // clear any previous interval stored in ref
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(() => {
        console.log('[interval] fetching latestMessages');
        fetchLatest();
      }, 10000);
    } catch (err) { setMessage(`Error: ${err?.response?.data?.message || err.message}`); }
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>Gmail OAuth </h2>
      <p>{message}</p>
      <div style={{ marginBottom: 12 }}>
        <a href="http://localhost:4000/">Login with Google</a>
      </div>
      <div style={{ marginBottom: 12 }}>
        <strong>Logged in as:</strong> {loggedInEmail || "not authenticated"}
      </div>

      <form onSubmit={handleSubmit}>
        <div>
          <label>Sender (from:) filter: </label>
          <input
            value={sender}
            onChange={(e) => setSender(e.target.value)}
            placeholder="sender@example.com"
          />
        </div>
        <div>
          <label>Subject filter (optional): </label>
          <input
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
          />
        </div>
        <button type="submit">Fetch mails</button>
        <button type="button" onClick={fetchLatest} style={{ marginLeft: 8 }}>Manual refresh</button>
      </form>

      {messagesList.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <h3>Messages ({messagesList.length})</h3>
          <ul>
            {messagesList.map((m) => (
              <li key={m.id} style={{ marginBottom: 8 }}>
                <div>
                  <strong>From:</strong> {m.from}
                </div>
                <div>
                  <strong>Subject:</strong> {m.subject}
                </div>
                <div>
                  <strong>Date:</strong> {m.date}
                </div>
                <div style={{ color: "#aaa" }}>{m.snippet}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default Home;
