import { supabase } from './supabase';
import type { User } from '@supabase/supabase-js';

export type AuthCallback = (user: User | null) => void;

let onAuthChange: AuthCallback = () => {};

export function setAuthCallback(cb: AuthCallback): void {
  onAuthChange = cb;
}

export async function initAuth(): Promise<void> {
  // Listen for auth state changes (login, logout, token refresh)
  supabase.auth.onAuthStateChange((_event, session) => {
    onAuthChange(session?.user ?? null);
  });

  // Check existing session
  const { data } = await supabase.auth.getSession();
  onAuthChange(data.session?.user ?? null);
}

export async function signUp(email: string, password: string): Promise<string | null> {
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) return error.message;
  return null;
}

export async function signIn(email: string, password: string): Promise<string | null> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return error.message;
  return null;
}

export async function signInWithGoogle(): Promise<string | null> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
  if (error) return error.message;
  return null;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}
