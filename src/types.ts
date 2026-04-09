export interface Expense {
  name: string;
  amount: number;
  category?: string;
  repeat?: 'daily' | 'weekly' | 'monthly';
  repeatId?: string;
}

export interface Subscription {
  name: string;
  amount: number;
  day: number;
  paid?: boolean;
  repeat?: 'daily' | 'weekly' | 'monthly';
  repeatId?: string;
}

export interface MonthData {
  budget: number;
  dailyBudget?: number;
  subscriptions: Subscription[];
  expenses: Record<string, Expense[]>;
}

export type BudgetStore = Record<string, MonthData>;

export interface MonthSummary {
  key: string;
  year: number;
  monthIndex: number;
  budget: number;
  dailyExpenses: number;
  subscriptions: number;
  totalSpent: number;
  remaining: number;
  hasData: boolean;
}

export interface YearSummary {
  year: number;
  months: MonthSummary[];
  totalBudget: number;
  totalExpenses: number;
  totalSubs: number;
  totalSpent: number;
  remaining: number;
}

export interface Bank {
  id: string;
  name: string;
  color: string;
}

export interface SavingsEntry {
  id: string;
  bankId: string;
  amount: number;
  date: string; // ISO date string YYYY-MM-DD
  note?: string;
}

export interface SavingsStore {
  banks: Bank[];
  entries: SavingsEntry[];
}
