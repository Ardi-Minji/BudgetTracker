export interface Expense {
  name: string;
  amount: number;
}

export interface Subscription {
  name: string;
  amount: number;
  day: number;
}

export interface MonthData {
  budget: number;
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
