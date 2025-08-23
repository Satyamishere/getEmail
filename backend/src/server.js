
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import router from './routes/user.route.js';




const app = express();

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));

// Use router at root level
app.get('/test', (req, res) => {
  console.log('Test route was hit');
  res.send('Test route works!');
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