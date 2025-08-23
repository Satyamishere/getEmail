import express from 'express';
//import login from '../controllers/google.js'; // Adjust path if needed
import { callback, login, searchmail } from '../controllers/google.js';
import authorise from '../utils/auth.js';
const router = express.Router();
router.get('/', login);
router.get('/auth/google/callback', callback);
router.post('/getmails', authorise, searchmail);


export default router;
