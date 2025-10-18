
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import router from './routes/user.route.js';




const app = express();

const allowedOrigins = [process.env.FRONTEND_URL || 'http://localhost:5173', process.env.DEPLOYED_FRONTEND || 'https://getemail-1.onrender.com'];
app.use(cors({
  origin: function(origin, callback) {
    // allow requests with no origin like mobile apps or curl
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      return callback(null, true);
    } else {
      return callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));

// Simple request logger (after body parsers) to help debug incoming requests from the frontend
app.use((req, res, next) => {
  try {
    const shortHeaders = { authorization: !!req.headers.authorization, cookie: !!req.headers.cookie };
    console.log(`[req] ${req.method} ${req.path} headers=${JSON.stringify(shortHeaders)}`);
    if (req.method === 'POST' || req.method === 'PUT') {
      try { if (req.body && Object.keys(req.body).length) console.log('[req] body:', JSON.stringify(req.body).slice(0,1000)); } catch (e) {}
    }
  } catch (e) { /* ignore logging errors */ }
  next();
});

app.use(router);

// Connect to MongoDB but don't let a connection failure crash the server during dev.
const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/getmail";
mongoose
  .connect(mongoUri)
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => {
    console.error('MongoDB connection error (continuing without DB):', err.message);
  });

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));