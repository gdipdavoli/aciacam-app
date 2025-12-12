
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseKey) {
    console.error("Supabase URL or Key is missing from environment variables.");
}

// Safe client creation for dev/build environments where env vars might be missing
export const supabase = (supabaseUrl && supabaseKey)
    ? createClient(supabaseUrl, supabaseKey)
    : {
        storage: {
            from: () => ({
                upload: async () => {
                    console.error("Supabase not configured");
                    return { error: new Error("Supabase URL or Key is missing") };
                },
                createSignedUrl: async () => {
                    console.error("Supabase not configured");
                    return { error: new Error("Supabase URL or Key is missing") };
                }
            })
        }
    } as any;
