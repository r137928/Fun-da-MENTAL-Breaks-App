import { z } from "zod";
export const breakType = z.enum(["stillness", "movement"]);
export const durationBucket = z.enum(["1_to_5", "5_to_10", "10_to_15", "15_to_20", "20+"]);
export const pagination = z.object({
    offset: z.coerce.number().int().min(0).max(1000000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(20),
});
// Only used to upgrade numeric durations from the original API.
export function bucketForMinutes(minutes) {
    if (minutes <= 5)
        return "1_to_5";
    if (minutes <= 10)
        return "5_to_10";
    if (minutes <= 15)
        return "10_to_15";
    if (minutes <= 20)
        return "15_to_20";
    return "20+";
}
