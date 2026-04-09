import { supabase } from './supabase';
import type { SavingsStore } from './types';

let currentUserId: string | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

const STORAGE_KEY = 'savingsData';
const DEFAULT: SavingsStore = { banks: [], entries: [] };

export function setSavingsUserId(uid: string | null): void {
  currentUserId = uid;
}

export async function loadSavings(): Promise<SavingsStore> {
  if (!currentUserId) return loadLocalSavings();

  const { data, error } = await supabase
    .from('savings_data')
    .select('data')
    .eq('user_id', currentUserId)
    .single();

  if (error || !data) {
    const local = loadLocalSavings();
    if (local.banks.length > 0 || local.entries.length > 0) {
      await saveRemoteSavings(local);
    }
    return local;
  }

  const store = data.data as SavingsStore;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  return store;
}

export function saveSavings(store: SavingsStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  if (!currentUserId) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveRemoteSavings(store), 800);
}

async function saveRemoteSavings(store: SavingsStore): Promise<void> {
  if (!currentUserId) return;
  await supabase
    .from('savings_data')
    .upsert(
      { user_id: currentUserId, data: store, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
}

function loadLocalSavings(): SavingsStore {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || JSON.stringify(DEFAULT));
}
