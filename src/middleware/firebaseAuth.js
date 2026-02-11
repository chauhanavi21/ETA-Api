import { initFirebase } from "../config/firebase.js";

const { auth } = initFirebase();

export default async function firebaseAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const match = header.match(/^Bearer\s+(.+)$/i);

    if (!match) {
      return res.status(401).json({ message: "Missing Authorization Bearer token" });
    }

    const decoded = await auth.verifyIdToken(match[1]);
    req.user = { uid: decoded.uid };
    next();
  } catch (e) {
    return res.status(401).json({ message: "Invalid or expired auth token" });
  }
}
