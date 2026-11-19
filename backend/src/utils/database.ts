import type { PostgrestError } from "@supabase/supabase-js";
export function checkDatabase(error: PostgrestError | null) {
  if (error) throw error;
}
