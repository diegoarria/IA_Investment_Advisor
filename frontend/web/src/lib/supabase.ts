import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://nyxcqjzeiyptyipigsaz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im55eGNxanplaXlwdHlpcGlnc2F6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1NDYwOTIsImV4cCI6MjA5NTEyMjA5Mn0.zrOA6106uiBblb95PHc-jEvtBkFfB8jIHjxC_qZrlwg";

let _client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!_client) {
    _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return _client;
}
