import { z } from "zod";
import { breakType, durationBucket, bucketForMinutes } from "../utils/validation.js";
const breakFields = z.object({
    title: z.string().trim().min(1).max(120),
    break_type: breakType,
    duration_bucket: durationBucket.optional(),
    // Accepted for compatibility with the original numeric-duration API.
    duration: z.number().int().min(1).max(1440).optional(),
    icon: z.string().trim().max(200).nullable().optional(),
}).strict();
function normalizeDuration(input) {
    if (input.duration !== undefined) {
        return { ...input, duration_bucket: input.duration_bucket ?? bucketForMinutes(input.duration) };
    }
    return input;
}
export const breakInput = breakFields
    .refine(value => value.duration_bucket !== undefined || value.duration !== undefined, {
    message: "Select one duration bucket",
    path: ["duration_bucket"],
})
    .transform(normalizeDuration);
export const breakPatch = breakFields.partial()
    .refine(value => Object.keys(value).length > 0, "Provide at least one field")
    .transform(normalizeDuration);
// Keep original response identifiers available to existing API callers.
const selection = "*, id:break_id, user_id:created_by";
export const Break = {
    list(db, _userId, offset, limit) {
        // RLS returns app-provided activities and the caller's own activities.
        return db.from("breaks").select(selection)
            .order("created_at", { ascending: false }).order("break_id", { ascending: false })
            .range(offset, offset + limit - 1);
    },
    create(db, userId, input) {
        return db.from("breaks").insert({ ...input, created_by: userId }).select(selection).single();
    },
    update(db, userId, id, input) {
        return db.from("breaks").update(input).eq("created_by", userId).eq("break_id", id)
            .select(selection).maybeSingle();
    },
    remove(db, userId, id) {
        return db.from("breaks").delete().eq("created_by", userId).eq("break_id", id)
            .select("break_id").maybeSingle();
    },
};
