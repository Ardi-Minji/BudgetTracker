import { supabase } from './supabase';
import type { BudgetStore } from './types';

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let currentUserId: string | null = null;

export function setUserId(uid: string | null): void {
  currentUserId = uid;
}

/** Load budget data: try Supabase first, fall back to localStorage cache */
export async function loadData(): Promise<BudgetStore> {
  if (!currentUserId) return loadLocal();

  const { data, error } = await supabase
    .from('budget_data')
    .select('data')
    .eq('user_id', currentUserId)
    .single();

  if (error || !data) {
    // No remote data yet — check if there's local data to migrate
    const local = loadLocal();
    if (Object.keys(local).length > 0) {
      // Push local data to Supabase for first-time users
      await saveRemote(local);
    }
    return local;
  }

  // Cache remotely loaded data locally
  const store = data.data as BudgetStore;
  localStorage.setItem('budgetData', JSON.stringify(store));
  return store;
}

/** Save data locally + debounced remote save */
export function saveData(store: BudgetStore): void {
  localStorage.setItem('budgetData', JSON.stringify(store));

  if (!currentUserId) return;

  // Debounce remote saves to avoid hammering the API on every keystroke
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveRemote(store);
  }, 800);
}

async function saveRemote(store: BudgetStore): Promise<void> {
  if (!currentUserId) return;

  await supabase
    .from('budget_data')
    .upsert(
      { user_id: currentUserId, data: store, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
}

function loadLocal(): BudgetStore {
  return JSON.parse(localStorage.getItem('budgetData') || '{}');
}
