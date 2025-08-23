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
    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }
    jwt.verify(token, process.env.ACCESS_TOKEN_KEY, (error, decoded) => {
        if (error) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = decoded;
        next();
    });
};

export default authorise;