import express from 'express';
//import login from '../controllers/google.js'; // Adjust path if needed
import { callback, login, searchmail, getLatestMessages, stopPolling, getPollStatus } from '../controllers/google.js';
import authorise from '../utils/auth.js';
const router = express.Router();
router.get('/', login);
router.get('/auth/google/callback', callback);
router.post('/getmails', authorise, searchmail);

// return latest cached messages for the authenticated user
router.get('/latestMessages', authorise, getLatestMessages);

// stop polling for this user
router.post('/stopmails', authorise, stopPolling);

// debug: status of polling and cached messages
router.get('/pollStatus', authorise, getPollStatus);


export default router;
