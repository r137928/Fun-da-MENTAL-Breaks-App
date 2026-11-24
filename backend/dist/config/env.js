import "dotenv/config";
import { z } from "zod";
export const env = z.object({
    SUPABASE_URL: z.string().url(),
    SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
    CLIENT_ORIGIN: z.string().url(),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
}).parse(process.env);
