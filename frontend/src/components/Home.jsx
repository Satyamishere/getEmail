import React, { useEffect, useState, useRef } from "react";
import axios from "axios";

function Home() {
  const [loggedInEmail, setLoggedInEmail] = useState("");
  const [sender, setSender] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [message, setMessage] = useState("");
  const [messagesList, setMessagesList] = useState([]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const access = params.get("access");
    const refresh = params.get("refresh");
    const emailParam = params.get("email");

    if (access) {
      localStorage.setItem("accessNotGoogleToken", access);
      if (refresh) localStorage.setItem("refreshNotGoogleToken", refresh);
      if (emailParam) setLoggedInEmail(emailParam);

      const cleanUrl = window.location.origin + window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);
      setMessage("Authenticated — tokens saved (dev mode)");
    }
  }, []);

  useEffect(() => {
    const stopOnUnload = async () => {
      try {
        const url = "http://localhost:4000/stopmails";
        const token = localStorage.getItem("accessNotGoogleToken");

        if (navigator.sendBeacon) {
          try {
            navigator.sendBeacon(url);
          } catch (e) {
            // ignore
          }
          return;
        }

        const headers = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        await fetch(url, {
          method: "POST",
          keepalive: true,
          credentials: "include",
          headers,
          body: token ? JSON.stringify({ token }) : undefined,
        });
      } catch (e) {
        // no-op
      }
    };

    window.addEventListener("beforeunload", stopOnUnload);
    return () => window.removeEventListener("beforeunload", stopOnUnload);
  }, []);

  const intervalRef = useRef(null);

  const fetchLatest = async () => {
    try {
      const token = localStorage.getItem("accessNotGoogleToken");
      if (!token) return;

      const response = await axios.get("http://localhost:4000/latestMessages", {
        headers: { Authorization: `Bearer ${token}` },
      });

      setMessagesList(response.data.messages || []);
    } catch (err) {
      console.error("[fetchLatest]", err);
    }
  };

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage("");

    try {
      const token = localStorage.getItem("accessNotGoogleToken");
      if (!token) {
        setMessage("No token found. Click login first.");
        return;
      }

      await axios.post(
        "http://localhost:4000/getmails",
        { filters: { from: sender || undefined, subject: subjectFilter || undefined } },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setMessage("Polling started on the server.");
      await fetchLatest();

      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(fetchLatest, 10000);
    } catch (err) {
      setMessage(`Error: ${err?.response?.data?.message || err.message}`);
    }
  };

  return (
    <div className="app-shell">
      <div className="app-card">
        <header className="hero-block">
          <div>
            <p className="eyebrow">Gmail filter listener</p>
            <h1>Connect your inbox, preview messages, and stay in control.</h1>
            <p className="hero-copy">Log in with Google, apply optional filters, and view recent message activity from the background watcher.</p>
          </div>
          <a className="button primary" href="http://localhost:4000/">
            Login with Google
          </a>
        </header>

        {message && <div className="status-banner">{message}</div>}

        <section className="meta-row">
          <div>
            <span className="meta-label">Connected account</span>
            <p>{loggedInEmail || "Not authenticated"}</p>
          </div>
        </section>

        <form className="filter-form" onSubmit={handleSubmit}>
          <div className="input-group">
            <label htmlFor="sender">Sender filter</label>
            <input
              id="sender"
              value={sender}
              onChange={(e) => setSender(e.target.value)}
              placeholder="sender@example.com"
            />
          </div>

          <div className="input-group">
            <label htmlFor="subject">Subject filter</label>
            <input
              id="subject"
              value={subjectFilter}
              onChange={(e) => setSubjectFilter(e.target.value)}
              placeholder="Optional subject keyword"
            />
          </div>

          <div className="form-actions">
            <button type="submit" className="button secondary">
              Fetch mails
            </button>
          </div>
        </form>

        {messagesList.length > 0 && (
          <div className="messages-panel">
            <div className="panel-header">
              <h2>Messages</h2>
              <span>{messagesList.length} results</span>
            </div>
            <ul className="message-list">
              {messagesList.map((item) => (
                <li key={item.id} className="message-card">
                  <div className="message-row">
                    <span className="message-label">From</span>
                    <span>{item.from}</span>
                  </div>
                  <div className="message-row">
                    <span className="message-label">Subject</span>
                    <span>{item.subject}</span>
                  </div>
                  <div className="message-row">
                    <span className="message-label">Date</span>
                    <span>{item.date}</span>
                  </div>
                  <p className="message-snippet">{item.snippet}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export default Home;
