import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://jlloiyzqxpilmnrgubjb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpsbG9peXpxeHBpbG1ucmd1YmpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA1NjAwNzYsImV4cCI6MjA4NjEzNjA3Nn0.vqgw24qv7tYOJeC9uh1Ra8xE4YK1wqqPZVdCaHBSeSc';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
