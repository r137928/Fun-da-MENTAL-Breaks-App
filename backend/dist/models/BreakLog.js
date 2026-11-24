import { z } from "zod";
import { breakType } from "../utils/validation.js";
export const logStatus = z.enum(["in_progress", "completed", "cancelled"]);
const timestamp = z.string().datetime({ offset: true });
const logFields = z.object({
    break_id: z.string().uuid().nullable().optional(),
    title: z.string().trim().min(1).max(120),
    break_type: breakType,
    source: z.enum(["timer", "manual"]),
    occurred_at: timestamp,
    actual_duration_secs: z.number().int().positive().max(2147483647).nullable().optional(),
    started_at: timestamp.nullable().optional(),
    completed_at: timestamp.nullable().optional(),
    mind_score_before: z.number().int().min(1).max(10).nullable().optional(),
    mind_score_after: z.number().int().min(1).max(10).nullable().optional(),
    break_presence_score: z.number().int().min(0).max(100).nullable().optional(),
    status: logStatus.optional(),
    icon: z.string().trim().max(200).nullable().optional(),
}).strict();
function validTimes(value) {
    const ordered = !value.started_at || !value.completed_at
        || Date.parse(value.completed_at) >= Date.parse(value.started_at);
    return ordered && (!value.completed_at || value.status !== "in_progress");
}
export const breakLogInput = logFields
    .transform(value => ({
    ...value,
    status: value.status ?? (value.source === "manual" ? "completed" : "in_progress"),
}))
    .refine(validTimes, "Completion must follow the start and cannot belong to an in-progress break");
export const breakLogPatch = logFields.partial()
    .refine(value => Object.keys(value).length > 0, "Provide at least one field")
    .refine(validTimes, "Completion must follow the start and cannot belong to an in-progress break");
export const BreakLog = {
    list(db, userId, offset, limit, status) {
        let query = db.from("break_logs").select("*").eq("user_id", userId);
        if (status)
            query = query.eq("status", status);
        return query.order("occurred_at", { ascending: false }).order("log_id", { ascending: false })
            .range(offset, offset + limit - 1);
    },
    findById(db, userId, id) {
        return db.from("break_logs").select("*").eq("user_id", userId).eq("log_id", id).maybeSingle();
    },
    create(db, userId, input) {
        return db.from("break_logs").insert({ ...input, user_id: userId }).select("*").single();
    },
    update(db, userId, id, input) {
        // Database checks validate the final row, including fields omitted from PATCH.
        return db.from("break_logs").update(input).eq("user_id", userId).eq("log_id", id)
            .select("*").maybeSingle();
    },
    remove(db, userId, id) {
        return db.from("break_logs").delete().eq("user_id", userId).eq("log_id", id)
            .select("log_id").maybeSingle();
    },
};
