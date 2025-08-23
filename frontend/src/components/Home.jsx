import React, { useEffect, useState } from 'react';
import axios from 'axios';

// backend URL hard-coded inline below per request

function Home() {
  const [loggedInEmail, setLoggedInEmail] = useState('');
  // sender = the "from:" filter in Gmail query for your mailbox
  const [sender, setSender] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [message, setMessage] = useState('');
  const [messagesList, setMessagesList] = useState([]);

  // Parse tokens from URL on mount (Option A flow)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const access = params.get('access');
    const refresh = params.get('refresh');
  const emailParam = params.get('email');
    if (access) {
      // store tokens in localStorage for dev usage (not secure for production)
      localStorage.setItem('accessNotGoogleToken', access);
      if (refresh) localStorage.setItem('refreshNotGoogleToken', refresh);
  if (emailParam) setLoggedInEmail(emailParam);
      // Clean the URL so tokens don't stay in history
      const cleanUrl = window.location.origin + window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);
  setMessage('Authenticated — tokens saved (dev mode)');
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage('');
    try {
      const token = localStorage.getItem('accessNotGoogleToken');
      if (!token) {
        setMessage('No token found. Click Login first.');
        return;
      }
    const resp = await axios.post(
  'https://getemail.onrender.com/getmails',
        { filters: { from: sender || undefined, subject: subjectFilter || undefined } },
        { headers: { Authorization: `Bearer ${token}` } }
      );
  setMessage(`Success: ${resp?.data?.message || 'done'}`);
  setMessagesList(resp?.data?.messages || []);
    } catch (err) {
      setMessage(`Error: ${err?.response?.data?.message || err.message}`);
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>Gmail OAuth </h2>
      <p>{message}</p>
      <div style={{ marginBottom: 12 }}>
  <a href="https://getemail.onrender.com/">Login with Google</a>
      </div>
      <div style={{ marginBottom: 12 }}>
        <strong>Logged in as:</strong> {loggedInEmail || 'not authenticated'}
      </div>
      <form onSubmit={handleSubmit}>
        <div>
          <label>Sender (from:) filter: </label>
          <input value={sender} onChange={(e) => setSender(e.target.value)} placeholder="sender@example.com" />
        </div>
        <div>
          <label>Subject filter (optional): </label>
          <input value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)} />
        </div>
        <button type="submit">Fetch mails</button>
      </form>
      {messagesList.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <h3>Messages ({messagesList.length})</h3>
          <ul>
            {messagesList.map((m) => (
              <li key={m.id} style={{ marginBottom: 8 }}>
                <div><strong>From:</strong> {m.from}</div>
                <div><strong>Subject:</strong> {m.subject}</div>
                <div><strong>Date:</strong> {m.date}</div>
                <div style={{ color: '#aaa' }}>{m.snippet}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default Home;


