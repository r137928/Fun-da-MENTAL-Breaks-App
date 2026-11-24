import { z } from "zod";
const preferences = z.array(z.enum(["stillness", "movement", "balanced", "depends"]))
    .max(4)
    .refine(values => new Set(values).size === values.length, "Preferences must be unique");
export const userInput = z.object({
    name: z.string().trim().min(1).max(100),
    nickname: z.string().trim().max(60).nullable().optional(),
    phone: z.string().trim().min(3).max(32).nullable().optional(),
    gender: z.enum(["female", "male", "non-binary", "prefer not to say"]),
    age: z.number().int().min(0).max(130),
    break_pref: preferences.default([]),
    goals: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
    color_palette: z.object({
        now: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        goal: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    }).strict().nullable().optional(),
}).strict();
export const userPatch = userInput.partial();
export const User = {
    findById(db, id) {
        return db.from("profiles").select("*").eq("user_id", id).maybeSingle();
    },
    create(db, id, input) {
        return db.from("profiles").insert({ ...input, user_id: id }).select("*").single();
    },
    update(db, id, input) {
        return db.from("profiles").update(input).eq("user_id", id).select("*").maybeSingle();
    },
};
