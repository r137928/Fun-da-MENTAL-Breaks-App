import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";
export const requireAuth = async (req, res, next) => {
    const match = /^Bearer (\S+)$/i.exec(req.get("Authorization") ?? "");
    if (!match) {
        res.status(401).json({ message: "Bearer access token required" });
        return;
    }
    const db = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
        global: { headers: { Authorization: "Bearer " + match[1] } },
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await db.auth.getUser(match[1]);
    if (error || !data.user) {
        res.status(401).json({ message: "Invalid or expired access token" });
        return;
    }
    req.userId = data.user.id;
    req.userEmail = data.user.email;
    req.db = db;
    next();
};
