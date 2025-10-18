import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";



const authorise = async (req, res, next) => {
    let token = null;
    const authhead = req.headers.authorization;
    if (authhead) {
        const parts = authhead.split(' ');
        if (parts.length === 2 && parts[0] === 'Bearer') token = parts[1];
    }
    // fallback to cookie
    if (!token && req.cookies && req.cookies.accessNotGoogleToken) {
        token = req.cookies.accessNotGoogleToken;
    }
    // fallback to token in body (useful for navigator.sendBeacon payloads) or query
    if (!token && req.body && req.body.token) {
        token = req.body.token;
    }
    if (!token && req.query && req.query.token) {
        token = req.query.token;
    }
    console.log('[auth] incoming request', req.method, req.path, 'authHeaderPresent:', !!authhead, 'cookiePresent:', !!(req.cookies && req.cookies.accessNotGoogleToken));
    if (!token) {
        console.log('[auth] no token found, rejecting');
        return res.status(401).json({ error: 'No token provided' });
    }
    jwt.verify(token, process.env.ACCESS_TOKEN_KEY, (error, decoded) => {
        if (error) {
            console.log('[auth] token verification failed:', error.message);
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        console.log('[auth] token verified for', decoded.email);
        req.user = decoded;
        next();
    });
};

export default authorise;