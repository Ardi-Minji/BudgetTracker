import { supabase } from './supabase';
import type { BudgetStore } from './types';

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let currentUserId: string | null = null;
let pendingSync = false;

export function setUserId(uid: string | null): void {
  currentUserId = uid;
}

export async function loadData(): Promise<BudgetStore> {
  if (!currentUserId) return loadLocal();

  const { data, error } = await supabase
    .from('budget_data')
    .select('data, updated_at')
    .eq('user_id', currentUserId)
    .single();

  if (error || !data) {
    const local = loadLocal();
    if (Object.keys(local).length > 0) {
      await saveRemote(local);
    }
    return local;
  }

  const remoteTime = data.updated_at ? new Date(data.updated_at).getTime() : 0;
  const localTime = getLocalTimestamp();

  if (localTime > remoteTime) {
    const local = loadLocal();
    await saveRemote(local);
    return local;
  }

  const store = data.data as BudgetStore;
  localStorage.setItem('budgetData', JSON.stringify(store));
  localStorage.removeItem('budgetLastModified');
  return store;
}

export function saveData(store: BudgetStore): void {
  localStorage.setItem('budgetData', JSON.stringify(store));
  localStorage.setItem('budgetLastModified', new Date().toISOString());

  if (!currentUserId) return;

  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveRemote(store);
  }, 800);
}

export async function syncIfPending(): Promise<void> {
  if (!pendingSync || !currentUserId) return;
  const local = loadLocal();
  if (Object.keys(local).length > 0) {
    await saveRemote(local);
  }
}

async function saveRemote(store: BudgetStore): Promise<void> {
  if (!currentUserId) return;

  try {
    const { error } = await supabase
      .from('budget_data')
      .upsert(
        { user_id: currentUserId, data: store, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );

    if (!error) {
      localStorage.removeItem('budgetLastModified');
      pendingSync = false;
    } else {
      pendingSync = true;
    }
  } catch {
    pendingSync = true;
  }
}

function loadLocal(): BudgetStore {
  return JSON.parse(localStorage.getItem('budgetData') || '{}');
}

function getLocalTimestamp(): number {
  const ts = localStorage.getItem('budgetLastModified');
  return ts ? new Date(ts).getTime() : 0;
}
