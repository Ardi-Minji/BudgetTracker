import type { BudgetStore, Expense, Subscription, MonthData, MonthSummary, YearSummary, SavingsStore, SavingsEntry } from './types';
import { initAuth, setAuthCallback, signIn, signUp, signInWithGoogle, signOut } from './auth';
import { loadData, saveData, setUserId, syncIfPending } from './store';
import { loadSavings, saveSavings, setSavingsUserId } from './savings';
import type { User } from '@supabase/supabase-js';

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ── Helpers ──────────────────────────────────────────────────────────
const el = (id: string): HTMLElement => document.getElementById(id)!;

// ── Theme ────────────────────────────────────────────────────────────
function getTheme(): string {
  return localStorage.getItem('budget-theme') || 'dark';
}

function setTheme(theme: string): void {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('budget-theme', theme);
  updateThemeToggleIcon(theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0f172a' : '#f8fafc');
}

function updateThemeToggleIcon(theme: string): void {
  const btn = document.getElementById('themeToggle');
  if (btn) {
    btn.innerHTML = theme === 'dark' ? '&#9790;' : '&#9728;';
  }
}

// Apply saved theme immediately
setTheme(getTheme());

function monthKey(y: number, m: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

function dayKey(y: number, m: number, d: number): string {
  return `${monthKey(y, m)}-${String(d).padStart(2, '0')}`;
}

function fmt(n: number): string {
  return '\u20B1' + Math.abs(n).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtShort(n: number): string {
  const v = Math.abs(n);
  if (v >= 1000) return (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + 'k';
  if (v === Math.floor(v)) return String(v);
  return v.toFixed(0);
}

function escHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

const CATEGORIES = ['food', 'transport', 'bills', 'shopping', 'health', 'entertainment', 'other'];

function catBadge(cat?: string): string {
  if (!cat) return '';
  return `<span class="cat-badge ${escHtml(cat)}">${escHtml(cat)}</span>`;
}

// ── Recurring Expense Generation ─────────────────────────────────────
function generateRecurring(
  startYear: number, startMonth: number, startDay: number,
  expense: Expense
): void {
  const rid = expense.repeatId || genId();
  const base: Expense = { ...expense, repeatId: rid };

  // Generate for the next 3 months from the start date
  const startDate = new Date(startYear, startMonth, startDay);
  const endDate = new Date(startYear, startMonth + 4, 0); // end of month+3

  if (base.repeat === 'daily') {
    const d = new Date(startDate);
    d.setDate(d.getDate() + 1); // skip the original day
    while (d <= endDate) {
      const y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
      const md = getMonthData(y, m);
      const dk = dayKey(y, m, day);
      if (!md.expenses[dk]) md.expenses[dk] = [];
      md.expenses[dk].push({ ...base });
      d.setDate(d.getDate() + 1);
    }
  } else if (base.repeat === 'weekly') {
    const d = new Date(startDate);
    d.setDate(d.getDate() + 7);
    while (d <= endDate) {
      const y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
      const md = getMonthData(y, m);
      const dk = dayKey(y, m, day);
      if (!md.expenses[dk]) md.expenses[dk] = [];
      md.expenses[dk].push({ ...base });
      d.setDate(d.getDate() + 7);
    }
  } else if (base.repeat === 'monthly') {
    for (let i = 1; i <= 3; i++) {
      const d = new Date(startYear, startMonth + i, 1);
      const maxDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      const day = Math.min(startDay, maxDay);
      const y = d.getFullYear(), m = d.getMonth();
      const md = getMonthData(y, m);
      const dk = dayKey(y, m, day);
      if (!md.expenses[dk]) md.expenses[dk] = [];
      md.expenses[dk].push({ ...base });
    }
  }
}

function generateRecurringSub(
  startYear: number, startMonth: number,
  sub: Subscription
): void {
  const rid = sub.repeatId || genId();
  const base: Subscription = { ...sub, repeatId: rid };

  if (base.repeat === 'monthly') {
    for (let i = 1; i <= 3; i++) {
      const d = new Date(startYear, startMonth + i, 1);
      const y = d.getFullYear(), m = d.getMonth();
      const maxDay = new Date(y, m + 1, 0).getDate();
      const md = getMonthData(y, m);
      md.subscriptions.push({ ...base, day: Math.min(base.day, maxDay), paid: false });
    }
  } else if (base.repeat === 'weekly' || base.repeat === 'daily') {
    // For subscriptions, weekly/daily still creates one entry per future month
    // since subscriptions are month-level items (not day-level expenses)
    for (let i = 1; i <= 3; i++) {
      const d = new Date(startYear, startMonth + i, 1);
      const y = d.getFullYear(), m = d.getMonth();
      const maxDay = new Date(y, m + 1, 0).getDate();
      const md = getMonthData(y, m);
      md.subscriptions.push({ ...base, day: Math.min(base.day, maxDay), paid: false });
    }
  }
}

function deleteRecurringSubFromMonth(repeatId: string, fromYear: number, fromMonth: number): void {
  for (const mk of Object.keys(data)) {
    const [yStr, mStr] = mk.split('-');
    const y = parseInt(yStr), m = parseInt(mStr) - 1;
    if (y < fromYear || (y === fromYear && m < fromMonth)) continue;
    const md = data[mk];
    if (!md.subscriptions) continue;
    md.subscriptions = md.subscriptions.filter(s => s.repeatId !== repeatId);
  }
}

// ── Confirm Dialog ──────────────────────────────────────────────────
function confirmAction(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const container = el('dialogContainer');
    container.innerHTML = `
      <div class="confirm-overlay">
        <div class="confirm-box">
          <p>${escHtml(message)}</p>
          <div class="confirm-actions">
            <button class="btn btn-secondary" id="confirmNo">Cancel</button>
            <button class="btn btn-danger" id="confirmYes">Delete</button>
          </div>
        </div>
      </div>
    `;
    el('confirmYes').addEventListener('click', () => { container.innerHTML = ''; resolve(true); });
    el('confirmNo').addEventListener('click', () => { container.innerHTML = ''; resolve(false); });
  });
}

// ── Edit Expense Modal ──────────────────────────────────────────────
function editExpenseModal(expense: Expense): Promise<Expense | null> {
  return new Promise((resolve) => {
    const container = el('dialogContainer');
    const catOptions = ['<option value="">No Category</option>']
      .concat(CATEGORIES.map(c =>
        `<option value="${c}" ${expense.category === c ? 'selected' : ''}>${c.charAt(0).toUpperCase() + c.slice(1)}</option>`
      )).join('');

    const repeatOptions = [
      { v: '', l: 'Repeat: None' }, { v: 'daily', l: 'Repeat: Daily' },
      { v: 'weekly', l: 'Repeat: Weekly' }, { v: 'monthly', l: 'Repeat: Monthly' },
    ].map(o => `<option value="${o.v}" ${(expense.repeat || '') === o.v ? 'selected' : ''}>${o.l}</option>`).join('');

    container.innerHTML = `
      <div class="edit-overlay">
        <div class="edit-box">
          <h3>Edit Expense</h3>
          <div class="form-row">
            <input type="text" id="editName" value="${escHtml(expense.name)}">
          </div>
          <div class="form-row">
            <input type="number" id="editAmount" value="${expense.amount}" min="0" step="0.01">
          </div>
          <div class="form-row">
            <select id="editCategory">${catOptions}</select>
          </div>
          <div class="form-row">
            <select id="editRepeat" style="width:100%;min-height:48px;">${repeatOptions}</select>
          </div>
          <div class="edit-actions">
            <button class="btn btn-secondary" id="editCancel" style="min-height:48px;">Cancel</button>
            <button class="btn btn-primary" id="editSave" style="min-height:48px;">Save</button>
          </div>
        </div>
      </div>
    `;
    el('editCancel').addEventListener('click', () => { container.innerHTML = ''; resolve(null); });
    el('editSave').addEventListener('click', () => {
      const name = (el('editName') as HTMLInputElement).value.trim();
      const amount = parseFloat((el('editAmount') as HTMLInputElement).value);
      const category = (el('editCategory') as HTMLSelectElement).value;
      const repeat = (el('editRepeat') as HTMLSelectElement).value as Expense['repeat'] | '';
      if (!name || !amount || amount <= 0) return;
      container.innerHTML = '';
      resolve({
        name, amount,
        ...(category ? { category } : {}),
        ...(repeat ? { repeat, repeatId: expense.repeatId || genId() } : {}),
      });
    });
  });
}

function editSubscriptionModal(sub: Subscription): Promise<Subscription | null> {
  return new Promise((resolve) => {
    const container = el('dialogContainer');
    const mm = String(currentMonth + 1).padStart(2, '0');
    const maxDay = new Date(currentYear, currentMonth + 1, 0).getDate();

    const repeatOptions = [
      { v: '', l: 'Repeat: None' }, { v: 'daily', l: 'Repeat: Daily' },
      { v: 'weekly', l: 'Repeat: Weekly' }, { v: 'monthly', l: 'Repeat: Monthly' },
    ].map(o => `<option value="${o.v}" ${(sub.repeat || '') === o.v ? 'selected' : ''}>${o.l}</option>`).join('');

    container.innerHTML = `
      <div class="edit-overlay">
        <div class="edit-box">
          <h3>Edit Subscription</h3>
          <div class="form-row">
            <input type="text" id="editSubName" value="${escHtml(sub.name)}" placeholder="Name">
          </div>
          <div class="form-row">
            <input type="number" id="editSubAmount" value="${sub.amount}" min="0" step="0.01" placeholder="Amount">
          </div>
          <div class="form-row">
            <label style="font-size:.8rem;color:var(--text-secondary);margin-bottom:4px;display:block;">Due Day</label>
            <input type="date" id="editSubDay" value="${currentYear}-${mm}-${String(sub.day).padStart(2, '0')}" min="${currentYear}-${mm}-01" max="${currentYear}-${mm}-${String(maxDay).padStart(2, '0')}">
          </div>
          <div class="form-row">
            <select id="editSubRepeat" style="width:100%;min-height:48px;">${repeatOptions}</select>
          </div>
          <div class="edit-actions">
            <button class="btn btn-secondary" id="editSubCancel" style="min-height:48px;">Cancel</button>
            <button class="btn btn-primary" id="editSubSave" style="min-height:48px;">Save</button>
          </div>
        </div>
      </div>
    `;
    el('editSubCancel').addEventListener('click', () => { container.innerHTML = ''; resolve(null); });
    el('editSubSave').addEventListener('click', () => {
      const name = (el('editSubName') as HTMLInputElement).value.trim();
      const amount = parseFloat((el('editSubAmount') as HTMLInputElement).value);
      const dateVal = (el('editSubDay') as HTMLInputElement).value;
      const day = dateVal ? new Date(dateVal + 'T00:00:00').getDate() : sub.day;
      const repeat = (el('editSubRepeat') as HTMLSelectElement).value as Subscription['repeat'] | '';
      if (!name || !amount || amount <= 0 || !day || day < 1 || day > 31) return;
      container.innerHTML = '';
      resolve({
        name, amount, day,
        ...(sub.paid ? { paid: sub.paid } : {}),
        ...(repeat ? { repeat: repeat as Subscription['repeat'], repeatId: sub.repeatId || genId() } : {}),
      });
    });
    container.querySelector('.edit-overlay')!.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) { container.innerHTML = ''; resolve(null); }
    });
  });
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// ── State ────────────────────────────────────────────────────────────
let currentYear: number;
let currentMonth: number;
let selectedDay: number | null;
let data: BudgetStore = {};
const expandedYears = new Set<number>();

// ── Savings State ────────────────────────────────────────────────────
let savingsData: SavingsStore = { banks: [], entries: [] };
let carouselIndex = 0;

// ── Brand Colors ─────────────────────────────────────────────────────
const BRAND_COLORS: Record<string, string> = {
  bdo: '#CC0000', bpi: '#003087', metrobank: '#003087',
  unionbank: '#0033A0', gotyme: '#00C389', maya: '#00B4D8',
  gcash: '#007DFF', wise: '#9FE870', other: '#94a3b8',
};
const BRAND_LIST = ['BDO', 'BPI', 'Metrobank', 'UnionBank', 'GoTyme', 'Maya', 'GCash', 'Wise', 'Other'];

function brandColor(name: string): string {
  return BRAND_COLORS[name.toLowerCase().replace(/\s/g, '')] ?? '#94a3b8';
}

// ── Savings Helpers ───────────────────────────────────────────────────
function totalSavings(): number {
  return savingsData.entries.reduce((s, e) => s + e.amount, 0);
}

function bankBalance(bankId: string): number {
  return savingsData.entries.filter(e => e.bankId === bankId).reduce((s, e) => s + e.amount, 0);
}

function save(): void {
  saveData(data);
}

function getMonthData(y: number, m: number): MonthData {
  const key = monthKey(y, m);
  if (!data[key]) data[key] = { budget: 0, subscriptions: [], expenses: {} };
  return data[key];
}

// ── Calendar Render ──────────────────────────────────────────────────
function render(): void {
  const md = getMonthData(currentYear, currentMonth);
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === currentYear && today.getMonth() === currentMonth;

  el('monthLabel').textContent = `${MONTH_NAMES[currentMonth]} ${currentYear}`;
  (el('budgetInput') as HTMLInputElement).value = md.budget ? String(md.budget) : '';
  (el('dailyBudgetInput') as HTMLSelectElement).value = md.dailyBudget ? String(md.dailyBudget) : '0';
  const mm = String(currentMonth + 1).padStart(2, '0');
  const daysInCurrentMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const subDayEl = el('subDay') as HTMLInputElement;
  subDayEl.value = `${currentYear}-${mm}-01`;
  subDayEl.min = `${currentYear}-${mm}-01`;
  subDayEl.max = `${currentYear}-${mm}-${String(daysInCurrentMonth).padStart(2, '0')}`;

  const firstDay = new Date(currentYear, currentMonth, 1).getDay();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const grid = el('calendarGrid');
  grid.innerHTML = '';

  for (let i = 0; i < firstDay; i++) {
    const div = document.createElement('div');
    div.className = 'day empty';
    grid.appendChild(div);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const div = document.createElement('div');
    div.className = 'day';
    if (isCurrentMonth && d === today.getDate()) div.classList.add('today');
    if (d === selectedDay) div.classList.add('selected');

    const dk = dayKey(currentYear, currentMonth, d);
    const dayExpenses = md.expenses[dk] || [];
    const daySubs = md.subscriptions.filter(s => s.day === d);

    const dayTotal = dayExpenses.reduce((sum, e) => sum + e.amount, 0);
    const subTotal = daySubs.reduce((sum, s) => sum + s.amount, 0);

    let html = `<div class="day-num">${d}</div>`;
    if (dayTotal > 0) html += `<div class="day-total">-${fmtShort(dayTotal)}</div>`;
    if (subTotal > 0) html += `<div class="day-sub">${fmtShort(subTotal)}</div>`;

    if (dayExpenses.length > 0 || daySubs.length > 0) {
      html += '<div class="dot-row">';
      for (let i = 0; i < Math.min(dayExpenses.length, 5); i++) html += '<div class="dot"></div>';
      for (let i = 0; i < Math.min(daySubs.length, 3); i++) html += '<div class="dot sub"></div>';
      html += '</div>';
    }

    div.innerHTML = html;
    const dayNum = d;
    div.addEventListener('click', () => {
      selectedDay = dayNum;
      triggerHaptic();
      render();
      // Reduce taps: jump straight to amount entry after selecting a date.
      const amountInput = el('expenseAmount') as HTMLInputElement;
      setTimeout(() => amountInput.focus(), 0);
    });
    grid.appendChild(div);
  }

  // Summary card calculations
  let totalExpenses = 0;
  for (const dk in md.expenses) {
    totalExpenses += (md.expenses[dk] || []).reduce((s, e) => s + e.amount, 0);
  }

  const totalSubAmount = md.subscriptions.reduce((s, sub) => s + sub.amount, 0);
  const dailyExpBudget = md.dailyBudget || 0;
  const remaining = dailyExpBudget - totalExpenses;
  const pct = dailyExpBudget > 0 ? Math.max(0, Math.min(100, (remaining / dailyExpBudget) * 100)) : 100;

  el('totalSpent').textContent = fmt(totalExpenses);
  el('totalSubs').textContent = fmt(totalSubAmount);

  const remEl = el('remaining');
  remEl.textContent = (remaining < 0 ? '-' : '') + fmt(remaining);
  remEl.className = 'value ' + (remaining >= 0 ? 'green' : 'red');

  const bar = el('progressBar');
  bar.style.width = pct + '%';
  bar.style.background = pct > 40 ? 'var(--success)' : pct > 15 ? 'var(--warning)' : 'var(--danger)';

  const elapsed = isCurrentMonth ? today.getDate() : daysInMonth;
  const avg = elapsed > 0 ? totalExpenses / elapsed : 0;
  el('dailyAvg').textContent = fmt(avg) + '/day';

  renderDayExpenses();
  renderSubscriptions();

  // Re-render summary if open
  if (el('summaryWrap').classList.contains('open')) {
    renderMonthlySummary();
  }
}

// ── Sidebar: Day Expenses ────────────────────────────────────────────
// ── Recurring Delete Bottom Sheet ────────────────────────────────────
function showRecurringDeleteSheet(name: string): Promise<'this' | 'future' | 'cancel'> {
  return new Promise((resolve) => {
    const container = el('dialogContainer');
    container.innerHTML = `
      <div class="bottom-sheet-overlay">
        <div class="bottom-sheet">
          <div class="sheet-handle"></div>
          <div class="sheet-title">Delete recurring expense "${escHtml(name)}"</div>
          <button class="sheet-btn danger" id="sheetDelThis">Delete this entry only</button>
          <button class="sheet-btn warn" id="sheetDelFuture">Delete all future entries</button>
          <button class="sheet-btn cancel" id="sheetCancel">Cancel</button>
        </div>
      </div>
    `;
    el('sheetDelThis').addEventListener('click', () => { container.innerHTML = ''; resolve('this'); });
    el('sheetDelFuture').addEventListener('click', () => { container.innerHTML = ''; resolve('future'); });
    el('sheetCancel').addEventListener('click', () => { container.innerHTML = ''; resolve('cancel'); });
    container.querySelector('.bottom-sheet-overlay')!.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) { container.innerHTML = ''; resolve('cancel'); }
    });
  });
}

function deleteRecurringFromDate(repeatId: string, fromYear: number, fromMonth: number, fromDay: number): void {
  const fromDate = new Date(fromYear, fromMonth, fromDay);
  // Scan all months in data
  for (const mk of Object.keys(data)) {
    const md = data[mk];
    if (!md.expenses) continue;
    for (const dk of Object.keys(md.expenses)) {
      const parts = dk.split('-');
      const y = parseInt(parts[0]), m = parseInt(parts[1]) - 1, d = parseInt(parts[2]);
      const entryDate = new Date(y, m, d);
      if (entryDate < fromDate) continue;
      md.expenses[dk] = md.expenses[dk].filter(e => e.repeatId !== repeatId);
      if (md.expenses[dk].length === 0) delete md.expenses[dk];
    }
  }
}

function renderDayExpenses(): void {
  const md = getMonthData(currentYear, currentMonth);
  const label = el('selectedDateLabel');
  const list = el('expenseList');

  if (!selectedDay) {
    label.textContent = 'Select a day on the calendar';
    list.innerHTML = '<div class="empty-msg">No day selected</div>';
    return;
  }

  label.textContent = `${MONTH_SHORT[currentMonth]} ${selectedDay}, ${currentYear}`;

  const dk = dayKey(currentYear, currentMonth, selectedDay);
  const expenses = md.expenses[dk] || [];

  if (expenses.length === 0) {
    list.innerHTML = '<div class="empty-msg">No expenses for this day</div>';
    return;
  }

  list.innerHTML = expenses.map((e, i) => `
    <div class="expense-item">
      <span class="name">${catBadge(e.category)}${escHtml(e.name)}${e.repeat ? `<span class="repeat-badge">${escHtml(e.repeat)}</span>` : ''}</span>
      <span class="amount">-${fmt(e.amount)}</span>
      <button class="dup-btn" data-idx="${i}" data-dk="${dk}" title="Duplicate to today">&#x2398;</button>
      <button class="edit-btn" data-idx="${i}" data-dk="${dk}" title="Edit">&#9998;</button>
      <button class="del-btn" data-idx="${i}" data-dk="${dk}">&times;</button>
    </div>
  `).join('');

  list.querySelectorAll<HTMLButtonElement>('.dup-btn').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const idx = parseInt(btn.dataset.idx!);
      const key = btn.dataset.dk!;
      const expense = md.expenses[key][idx];
      const today = new Date();
      const ty = today.getFullYear(), tm = today.getMonth(), td = today.getDate();
      const todayMd = getMonthData(ty, tm);
      const todayDk = dayKey(ty, tm, td);
      if (!todayMd.expenses[todayDk]) todayMd.expenses[todayDk] = [];
      todayMd.expenses[todayDk].push({ name: expense.name, amount: expense.amount, ...(expense.category ? { category: expense.category } : {}) });
      save(); render();
    });
  });

  list.querySelectorAll<HTMLButtonElement>('.edit-btn').forEach(btn => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const idx = parseInt(btn.dataset.idx!);
      const key = btn.dataset.dk!;
      const expense = md.expenses[key][idx];
      const result = await editExpenseModal(expense);
      if (result) {
        md.expenses[key][idx] = result;
        save(); render();
      }
    });
  });

  list.querySelectorAll<HTMLButtonElement>('.del-btn').forEach(btn => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const idx = parseInt(btn.dataset.idx!);
      const key = btn.dataset.dk!;
      const expense = md.expenses[key][idx];

      if (expense.repeatId) {
        const choice = await showRecurringDeleteSheet(expense.name);
        if (choice === 'cancel') return;
        if (choice === 'this') {
          md.expenses[key].splice(idx, 1);
          if (md.expenses[key].length === 0) delete md.expenses[key];
        } else if (choice === 'future') {
          deleteRecurringFromDate(expense.repeatId, currentYear, currentMonth, selectedDay!);
        }
      } else {
        const confirmed = await confirmAction(`Delete "${expense.name}"?`);
        if (!confirmed) return;
        md.expenses[key].splice(idx, 1);
        if (md.expenses[key].length === 0) delete md.expenses[key];
      }
      save(); render();
    });
  });
}

// ── Sidebar: Subscriptions ───────────────────────────────────────────
function renderSubscriptions(): void {
  const md = getMonthData(currentYear, currentMonth);
  const list = el('subList');

  if (md.subscriptions.length === 0) {
    list.innerHTML = '<div class="empty-msg">No subscriptions added</div>';
    return;
  }

  list.innerHTML = md.subscriptions.map((s, i) => `
    <div class="sub-item ${s.paid ? 'paid' : ''}">
      <input type="checkbox" class="sub-check" data-idx="${i}" ${s.paid ? 'checked' : ''}>
      <div class="info">${escHtml(s.name)}${s.repeat ? `<span class="repeat-badge">${escHtml(s.repeat)}</span>` : ''}<small>Due: Day ${s.day}</small></div>
      <span class="amount">${fmt(s.amount)}</span>
      <button class="dup-btn" data-idx="${i}" title="Duplicate to this month">&#x2398;</button>
      <button class="edit-btn" data-idx="${i}">&#9998;</button>
      <button class="del-btn" data-idx="${i}">&times;</button>
    </div>
  `).join('');

  list.querySelectorAll<HTMLInputElement>('.sub-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const idx = parseInt(cb.dataset.idx!);
      md.subscriptions[idx].paid = cb.checked;
      save(); renderSubscriptions();
    });
  });

  list.querySelectorAll<HTMLButtonElement>('.dup-btn').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const idx = parseInt(btn.dataset.idx!);
      const sub = md.subscriptions[idx];
      const today = new Date();
      const ty = today.getFullYear(), tm = today.getMonth();
      const todayMd = getMonthData(ty, tm);
      todayMd.subscriptions.push({ name: sub.name, amount: sub.amount, day: sub.day, paid: false });
      save(); render();
    });
  });

  list.querySelectorAll<HTMLButtonElement>('.edit-btn').forEach(btn => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const idx = parseInt(btn.dataset.idx!);
      const sub = md.subscriptions[idx];
      const result = await editSubscriptionModal(sub);
      if (!result) return;
      md.subscriptions[idx] = result;
      save(); render();
    });
  });

  list.querySelectorAll<HTMLButtonElement>('.del-btn').forEach(btn => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const idx = parseInt(btn.dataset.idx!);
      const sub = md.subscriptions[idx];

      if (sub.repeatId) {
        const choice = await showRecurringDeleteSheet(sub.name);
        if (choice === 'cancel') return;
        if (choice === 'this') {
          md.subscriptions.splice(idx, 1);
        } else if (choice === 'future') {
          deleteRecurringSubFromMonth(sub.repeatId, currentYear, currentMonth);
        }
      } else {
        const confirmed = await confirmAction(`Delete "${sub.name}"?`);
        if (!confirmed) return;
        md.subscriptions.splice(idx, 1);
      }
      save(); render();
    });
  });
}

// ── Monthly Summary (grouped by year) ────────────────────────────────

function computeMonthSummary(key: string): MonthSummary {
  const md: MonthData = data[key] || { budget: 0, subscriptions: [], expenses: {} };
  const [yStr, mStr] = key.split('-');
  const year = parseInt(yStr);
  const monthIndex = parseInt(mStr) - 1;

  let dailyExpenses = 0;
  for (const dk in md.expenses) {
    dailyExpenses += (md.expenses[dk] || []).reduce((s, e) => s + e.amount, 0);
  }
  const subscriptions = (md.subscriptions || []).reduce((s, sub) => s + sub.amount, 0);
  const totalSpent = dailyExpenses + subscriptions;
  const remaining = (md.budget || 0) - totalSpent;
  const hasData = md.budget > 0 || dailyExpenses > 0 || subscriptions > 0;

  return { key, year, monthIndex, budget: md.budget || 0, dailyExpenses, subscriptions, totalSpent, remaining, hasData };
}

function buildYearSummaries(): YearSummary[] {
  const allKeys = new Set<string>();
  for (const key in data) {
    if (/^\d{4}-\d{2}$/.test(key)) allKeys.add(key);
  }

  const byYear = new Map<number, MonthSummary[]>();
  for (const key of allKeys) {
    const ms = computeMonthSummary(key);
    if (!ms.hasData) continue; // Skip months with no data
    if (!byYear.has(ms.year)) byYear.set(ms.year, []);
    byYear.get(ms.year)!.push(ms);
  }

  const years: YearSummary[] = [];
  for (const [year, months] of byYear) {
    months.sort((a, b) => a.monthIndex - b.monthIndex);
    const totalBudget = months.reduce((s, m) => s + m.budget, 0);
    const totalExpenses = months.reduce((s, m) => s + m.dailyExpenses, 0);
    const totalSubs = months.reduce((s, m) => s + m.subscriptions, 0);
    const totalSpent = totalExpenses + totalSubs;
    const remaining = totalBudget - totalSpent;
    years.push({ year, months, totalBudget, totalExpenses, totalSubs, totalSpent, remaining });
  }

  years.sort((a, b) => b.year - a.year);
  return years;
}

function statusBadge(hasData: boolean, remaining: number): string {
  if (!hasData) return '<span class="status-badge empty">No Data</span>';
  return remaining >= 0
    ? '<img src="/icons/Good-budget.png" alt="Under Budget" class="status-icon">'
    : '<img src="/icons/Bad-budget.png" alt="Over Budget" class="status-icon">';
}

// ── Month Detail Modal ──────────────────────────────────────────────
function showMonthDetail(year: number, monthIdx: number): void {
  const key = monthKey(year, monthIdx);
  const md: MonthData = data[key] || { budget: 0, subscriptions: [], expenses: {} };

  // Compute category breakdown
  const catTotals = new Map<string, number>();
  let totalDailyExp = 0;
  for (const dk in md.expenses) {
    for (const e of md.expenses[dk] || []) {
      const cat = e.category || 'uncategorized';
      catTotals.set(cat, (catTotals.get(cat) || 0) + e.amount);
      totalDailyExp += e.amount;
    }
  }

  const totalSubs = md.subscriptions.reduce((s, sub) => s + sub.amount, 0);
  const totalSpent = totalDailyExp + totalSubs;
  const remaining = (md.budget || 0) - totalSpent;
  const hasData = md.budget > 0 || totalDailyExp > 0 || totalSubs > 0;

  // Sort categories by amount descending
  const sorted = [...catTotals.entries()].sort((a, b) => b[1] - a[1]);
  const maxCat = sorted.length > 0 ? sorted[0][1] : 0;

  // Category bar colors
  const catColors: Record<string, string> = {
    food: '#f97316', transport: '#3b82f6', bills: '#eab308', shopping: '#ec4899',
    health: '#22c55e', entertainment: '#a855f7', other: '#94a3b8', uncategorized: '#64748b',
  };

  let catRowsHtml = '';
  if (sorted.length === 0) {
    catRowsHtml = '<div class="empty-msg">No expenses recorded</div>';
  } else {
    for (const [cat, amount] of sorted) {
      const pct = totalDailyExp > 0 ? (amount / totalDailyExp * 100) : 0;
      const barW = maxCat > 0 ? (amount / maxCat * 100) : 0;
      const color = catColors[cat] || '#64748b';
      const label = cat.charAt(0).toUpperCase() + cat.slice(1);
      catRowsHtml += `
        <div class="cat-row">
          <div class="cat-info">
            <span class="cat-badge ${escHtml(cat)}">${escHtml(label)}</span>
            <div class="cat-bar-bg"><div class="cat-bar" style="width:${barW}%;background:${color};"></div></div>
          </div>
          <span class="cat-pct">${pct.toFixed(0)}%</span>
          <span class="cat-amount">${fmt(amount)}</span>
        </div>
      `;
    }
  }

  // Subscription breakdown
  let subsHtml = '';
  if (md.subscriptions.length > 0) {
    subsHtml = '<div class="cat-section-title" style="margin-top:14px;">Subscriptions</div>';
    for (const s of md.subscriptions) {
      subsHtml += `
        <div class="cat-row">
          <div class="cat-info">
            <span style="font-size:.85rem;">${escHtml(s.name)}</span>
            <small style="color:var(--text-tertiary);font-size:.7rem;">Day ${s.day}</small>
          </div>
          <span class="cat-amount" style="color:var(--purple);">${fmt(s.amount)}</span>
        </div>
      `;
    }
  }

  const container = el('dialogContainer');
  container.innerHTML = `
    <div class="detail-overlay">
      <div class="detail-box">
        <h3>${MONTH_NAMES[monthIdx]} ${year}</h3>
        <div class="detail-status">${statusBadge(hasData, remaining)}</div>
        <div class="detail-stats">
          <div><div class="ds-label">Budget</div><div class="ds-val" style="color:var(--accent);">${md.budget > 0 ? fmt(md.budget) : '-'}</div></div>
          <div><div class="ds-label">Daily Expenses</div><div class="ds-val" style="color:var(--danger);">${totalDailyExp > 0 ? fmt(totalDailyExp) : '-'}</div></div>
          <div><div class="ds-label">Subscriptions</div><div class="ds-val" style="color:var(--purple);">${totalSubs > 0 ? fmt(totalSubs) : '-'}</div></div>
          <div><div class="ds-label">Remaining</div><div class="ds-val" style="color:var(${remaining >= 0 ? '--success' : '--danger'});">${hasData ? (remaining < 0 ? '-' : '') + fmt(remaining) : '-'}</div></div>
        </div>
        <div class="cat-section-title">Expenses by Category</div>
        ${catRowsHtml}
        ${subsHtml}
        <div class="detail-actions">
          <button class="btn btn-secondary" id="detailClose">Close</button>
          <button class="btn btn-primary" id="detailGoTo">Go to Month</button>
        </div>
      </div>
    </div>
  `;

  el('detailClose').addEventListener('click', () => { container.innerHTML = ''; });
  el('detailGoTo').addEventListener('click', () => {
    container.innerHTML = '';
    currentYear = year;
    currentMonth = monthIdx;
    selectedDay = null;
    render();
  });

  // Close on overlay click
  container.querySelector('.detail-overlay')!.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) container.innerHTML = '';
  });
}

function renderMonthlySummary(): void {
  const body = el('summaryBody');
  const mobileWrap = el('summaryCardsMobile');
  const today = new Date();
  const yearSummaries = buildYearSummaries();

  if (expandedYears.size === 0) {
    expandedYears.add(currentYear);
  }

  let tableHtml = '';
  let cardsHtml = '';
  let grandBudget = 0;
  let grandExpenses = 0;
  let grandSubs = 0;

  for (const ys of yearSummaries) {
    const isExpanded = expandedYears.has(ys.year);
    const yearHasData = ys.totalBudget > 0 || ys.totalExpenses > 0 || ys.totalSubs > 0;

    grandBudget += ys.totalBudget;
    grandExpenses += ys.totalExpenses;
    grandSubs += ys.totalSubs;

    // ── Desktop table rows ──
    tableHtml += `
      <tr class="year-header-row ${isExpanded ? 'expanded' : ''}" data-year="${ys.year}">
        <td class="year-header-cell">
          <span class="year-chevron">${isExpanded ? '&#9660;' : '&#9654;'}</span>
          <strong>${ys.year}</strong>
        </td>
        <td class="budget-col">${ys.totalBudget > 0 ? fmt(ys.totalBudget) : '-'}</td>
        <td class="spent-col">${ys.totalExpenses > 0 ? fmt(ys.totalExpenses) : '-'}</td>
        <td class="subs-col">${ys.totalSubs > 0 ? fmt(ys.totalSubs) : '-'}</td>
        <td class="spent-col">${ys.totalSpent > 0 ? fmt(ys.totalSpent) : '-'}</td>
        <td class="remain-col ${ys.remaining >= 0 ? 'positive' : 'negative'}">${yearHasData ? (ys.remaining < 0 ? '-' : '') + fmt(ys.remaining) : '-'}</td>
        <td class="status-col">${statusBadge(yearHasData, ys.remaining)}</td>
      </tr>
    `;

    // ── Mobile: year card group ──
    cardsHtml += `<div class="year-card-group" data-year="${ys.year}">`;
    cardsHtml += `
      <div class="year-card-header" data-year="${ys.year}">
        <div class="year-title">
          <span class="year-chevron">${isExpanded ? '&#9660;' : '&#9654;'}</span>
          ${ys.year}
        </div>
        <div class="year-stats">
          <span class="ys-budget">${ys.totalBudget > 0 ? fmt(ys.totalBudget) : '-'}</span>
          <span class="ys-remain ${ys.remaining >= 0 ? 'positive' : 'negative'}">${yearHasData ? (ys.remaining < 0 ? '-' : '') + fmt(ys.remaining) : '-'}</span>
        </div>
      </div>
    `;

    if (isExpanded) {
      cardsHtml += '<div class="month-cards">';
      for (const ms of ys.months) {
        const isCurrent = ms.year === today.getFullYear() && ms.monthIndex === today.getMonth();
        const isViewing = ms.year === currentYear && ms.monthIndex === currentMonth;

        // Desktop table row
        tableHtml += `
          <tr class="month-row ${isCurrent ? 'current-row' : ''} ${isViewing ? 'viewing-row' : ''}" data-y="${ms.year}" data-m="${ms.monthIndex}">
            <td class="month-name">${MONTH_NAMES[ms.monthIndex]}</td>
            <td class="budget-col">${ms.budget > 0 ? fmt(ms.budget) : '-'}</td>
            <td class="spent-col">${ms.dailyExpenses > 0 ? fmt(ms.dailyExpenses) : '-'}</td>
            <td class="subs-col">${ms.subscriptions > 0 ? fmt(ms.subscriptions) : '-'}</td>
            <td class="spent-col">${ms.totalSpent > 0 ? fmt(ms.totalSpent) : '-'}</td>
            <td class="remain-col ${ms.remaining >= 0 ? 'positive' : 'negative'}">${ms.hasData ? (ms.remaining < 0 ? '-' : '') + fmt(ms.remaining) : '-'}</td>
            <td class="status-col">${statusBadge(ms.hasData, ms.remaining)}</td>
          </tr>
        `;

        // Mobile card
        const remainColor = !ms.hasData ? 'blue' : ms.remaining >= 0 ? 'green' : 'red';
        cardsHtml += `
          <div class="month-card ${isCurrent ? 'current-card' : ''} ${isViewing ? 'viewing-card' : ''}" data-y="${ms.year}" data-m="${ms.monthIndex}">
            <div class="month-card-head">
              <span class="mc-name">${MONTH_NAMES[ms.monthIndex]}</span>
              ${statusBadge(ms.hasData, ms.remaining)}
            </div>
            <div class="month-card-grid">
              <div class="mc-item">
                <div class="mc-label">Budget</div>
                <div class="mc-val blue">${ms.budget > 0 ? fmt(ms.budget) : '-'}</div>
              </div>
              <div class="mc-item">
                <div class="mc-label">Expenses</div>
                <div class="mc-val red">${ms.dailyExpenses > 0 ? fmt(ms.dailyExpenses) : '-'}</div>
              </div>
              <div class="mc-item">
                <div class="mc-label">Subscriptions</div>
                <div class="mc-val purple">${ms.subscriptions > 0 ? fmt(ms.subscriptions) : '-'}</div>
              </div>
              <div class="mc-item">
                <div class="mc-label">Remaining</div>
                <div class="mc-val ${remainColor}">${ms.hasData ? (ms.remaining < 0 ? '-' : '') + fmt(ms.remaining) : '-'}</div>
              </div>
            </div>
          </div>
        `;
      }
      cardsHtml += '</div>';
    }

    cardsHtml += '</div>';
  }

  // Inject HTML
  body.innerHTML = tableHtml;
  mobileWrap.innerHTML = cardsHtml;

  // ── Desktop: year row toggle ──
  body.querySelectorAll<HTMLTableRowElement>('.year-header-row').forEach(row => {
    row.addEventListener('click', () => {
      const year = parseInt(row.dataset.year!);
      if (expandedYears.has(year)) expandedYears.delete(year);
      else expandedYears.add(year);
      renderMonthlySummary();
    });
  });

  // ── Desktop: month row → show detail ──
  body.querySelectorAll<HTMLTableRowElement>('.month-row').forEach(row => {
    row.addEventListener('click', () => {
      showMonthDetail(parseInt(row.dataset.y!), parseInt(row.dataset.m!));
    });
  });

  // ── Mobile: year header toggle ──
  mobileWrap.querySelectorAll<HTMLElement>('.year-card-header').forEach(header => {
    header.addEventListener('click', () => {
      const year = parseInt(header.dataset.year!);
      if (expandedYears.has(year)) expandedYears.delete(year);
      else expandedYears.add(year);
      renderMonthlySummary();
    });
  });

  // ── Mobile: month card → show detail ──
  mobileWrap.querySelectorAll<HTMLElement>('.month-card').forEach(card => {
    card.addEventListener('click', () => {
      showMonthDetail(parseInt(card.dataset.y!), parseInt(card.dataset.m!));
    });
  });

  // Per-year totals (only for expanded/selected years)
  let totalsHtml = '';
  for (const ys of yearSummaries) {
    if (!expandedYears.has(ys.year)) continue;
    const yearHasData = ys.totalBudget > 0 || ys.totalExpenses > 0 || ys.totalSubs > 0;
    if (!yearHasData) continue;
    const savings = ys.remaining;
    totalsHtml += `
      <div class="st-year-group">
        <div class="st-year-label">${ys.year}</div>
        <div class="st-year-grid">
          <div class="st-card">
            <div class="st-label">Budget</div>
            <div class="st-value" style="color:var(--accent);">${fmt(ys.totalBudget)}</div>
          </div>
          <div class="st-card">
            <div class="st-label">Expenses</div>
            <div class="st-value" style="color:var(--danger);">${fmt(ys.totalExpenses)}</div>
          </div>
          <div class="st-card">
            <div class="st-label">Subscriptions</div>
            <div class="st-value" style="color:var(--purple);">${fmt(ys.totalSubs)}</div>
          </div>
          <div class="st-card">
            <div class="st-label">Savings</div>
            <div class="st-value" style="color:var(${savings >= 0 ? '--success' : '--danger'});">${savings < 0 ? '-' : ''}${fmt(savings)}</div>
          </div>
        </div>
      </div>
    `;
  }
  el('summaryTotals').innerHTML = totalsHtml;
}

// ── Savings ──────────────────────────────────────────────────────────

// ── Task 2: Carousel rendering ────────────────────────────────────────
function buildCarouselHTML(): void {
  const banks = savingsData.banks;
  const carousel = el('savingsCarousel');

  // Static total hero (separate from carousel)
  const heroEl = document.getElementById('savingsTotalHero');
  if (heroEl) {
    if (banks.length === 0) {
      heroEl.innerHTML = `
        <div class="hero-label">Total Savings</div>
        <div class="hero-amount">${fmt(totalSavings())}</div>
        <div style="font-size:.8rem;color:var(--text-tertiary);margin-top:6px;">Tap + to add your first bank</div>
      `;
    } else {
      heroEl.innerHTML = `
        <div class="hero-label">Total Savings</div>
        <div class="hero-amount">${fmt(totalSavings())}</div>
      `;
    }
  }

  // Carousel: bank cards only
  if (banks.length === 0) {
    carousel.innerHTML = '';
    return;
  }

  let html = '';
  for (const bank of banks) {
    const bal = bankBalance(bank.id);
    const color = bank.color || brandColor(bank.name);
    const glow = color + '4D';
    html += `
      <div class="carousel-card" data-bid="${bank.id}"
        style="border-left:4px solid ${color};box-shadow:0 0 16px ${glow};">
        <div style="font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:${color};margin-bottom:8px;">${escHtml(bank.name)}</div>
        <div style="font-size:2rem;font-weight:800;color:var(--text-primary);">${fmt(bal)}</div>
      </div>
    `;
  }

  carousel.innerHTML = html;
  // Clamp index to valid range after re-render
  carouselIndex = Math.max(0, Math.min(carouselIndex, banks.length - 1));
  carousel.style.transform = `translateX(-${carouselIndex * 100}%)`;
}

function syncCarouselDots(): void {
  const banks = savingsData.banks;
  let html = '';
  for (let i = 0; i < banks.length; i++) {
    html += `<div class="carousel-dot${i === carouselIndex ? ' active' : ''}"></div>`;
  }
  el('carouselDots').innerHTML = html;
}

let carouselGesturesInitialized = false;

function attachCarouselGestures(): void {
  if (carouselGesturesInitialized) return;
  carouselGesturesInitialized = true;

  const wrap = document.querySelector<HTMLElement>('.savings-carousel-wrap');
  if (!wrap) return;

  let startX = 0;
  let startY = 0;
  let isDragging = false;

  function onStart(x: number, y: number): void {
    startX = x;
    startY = y;
    isDragging = true;
  }

  function onEnd(endX: number, endY: number, target: EventTarget | null): void {
    if (!isDragging) return;
    isDragging = false;
    const deltaX = endX - startX;
    const deltaY = endY - startY;

    if (Math.abs(deltaX) > 40 && Math.abs(deltaX) > Math.abs(deltaY)) {
      const maxIndex = savingsData.banks.length - 1;
      if (maxIndex < 0) return;
      if (deltaX < 0) {
        carouselIndex = Math.min(carouselIndex + 1, maxIndex);
      } else {
        carouselIndex = Math.max(carouselIndex - 1, 0);
      }
      el('savingsCarousel').style.transform = `translateX(-${carouselIndex * 100}%)`;
      syncCarouselDots();
    } else if (Math.abs(deltaX) <= 10 && Math.abs(deltaY) <= 10) {
      // Tap — check for bank card
      const cardEl = (target as HTMLElement)?.closest<HTMLElement>('[data-bid]');
      if (cardEl) {
        const bankId = cardEl.dataset.bid!;
        openDepositSheet(bankId);
      }
    }
  }

  wrap.addEventListener('touchstart', (e) => {
    onStart(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });

  wrap.addEventListener('touchend', (e) => {
    onEnd(e.changedTouches[0].clientX, e.changedTouches[0].clientY, e.target);
  }, { passive: true });

  wrap.addEventListener('mousedown', (e) => {
    onStart(e.clientX, e.clientY);
  });

  wrap.addEventListener('mouseup', (e) => {
    onEnd(e.clientX, e.clientY, e.target);
  });
}

// ── Task 3: FAB ───────────────────────────────────────────────────────
let fabInitialized = false;

function initFab(): void {
  if (fabInitialized) return;
  fabInitialized = true;

  const fab = el('savingsFab');
  const fabMenu = el('fabMenu');
  const fabWrap = el('savingsFabWrap');

  fab.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = fabMenu.hasAttribute('hidden');
    if (isHidden) {
      fabMenu.removeAttribute('hidden');
      fab.classList.add('open');
    } else {
      fabMenu.setAttribute('hidden', '');
      fab.classList.remove('open');
    }
  });

  document.addEventListener('click', (e) => {
    if (!fabWrap.contains(e.target as Node)) {
      fabMenu.setAttribute('hidden', '');
      fab.classList.remove('open');
    }
  });

  el('fabDeposit').addEventListener('click', () => {
    fabMenu.setAttribute('hidden', '');
    fab.classList.remove('open');
    openDepositSheet(null);
  });

  el('fabAddBank').addEventListener('click', () => {
    fabMenu.setAttribute('hidden', '');
    fab.classList.remove('open');
    openAddBankSheet();
  });
}

// ── Task 4: Deposit Entry Bottom Sheet ────────────────────────────────
function openDepositSheet(bankId: string | null, entry?: SavingsEntry): void {
  const banks = savingsData.banks;
  const isEdit = !!entry;
  const today = new Date().toISOString().slice(0, 10);

  const bankOptions = banks.map(b =>
    `<option value="${b.id}" ${(entry ? entry.bankId === b.id : bankId === b.id) ? 'selected' : ''}>${escHtml(b.name)}</option>`
  ).join('');

  const container = el('dialogContainer');
  container.innerHTML = `
    <div class="bottom-sheet-overlay" id="depositOverlay">
      <div class="bottom-sheet" id="depositSheet">
        <div class="sheet-handle" id="depositHandle"></div>
        <div class="sheet-title">${isEdit ? 'Edit Deposit' : 'Record Deposit'}</div>
        <div class="sheet-field">
          <label>Bank</label>
          <select id="sheetBankSel">
            <option value="">Select bank</option>
            ${bankOptions}
          </select>
          <div class="sheet-field-error" id="sheetBankErr"></div>
        </div>
        <div class="sheet-field">
          <label>Amount</label>
          <input type="number" id="sheetAmount" min="0.01" step="0.01" placeholder="0.00"
            value="${entry ? entry.amount : ''}">
          <div class="sheet-field-error" id="sheetAmountErr"></div>
        </div>
        <div class="sheet-field">
          <label>Date</label>
          <input type="date" id="sheetDate" value="${entry ? entry.date : today}">
        </div>
        <div class="sheet-field">
          <label>Note (optional)</label>
          <input type="text" id="sheetNote" placeholder="e.g. Monthly savings"
            value="${entry ? escHtml(entry.note ?? '') : ''}">
        </div>
        <button class="sheet-btn" id="sheetSaveBtn"
          style="background:var(--btn-primary);color:#fff;margin-top:4px;">Save</button>
      </div>
    </div>
  `;

  // Drag-down dismiss
  const sheet = el('depositSheet');
  const handle = el('depositHandle');
  let sheetStartY = 0;
  handle.addEventListener('touchstart', (e) => { sheetStartY = e.touches[0].clientY; }, { passive: true });
  handle.addEventListener('touchend', (e) => {
    if (e.changedTouches[0].clientY - sheetStartY > 60) container.innerHTML = '';
  }, { passive: true });
  sheet.addEventListener('touchstart', (e) => { sheetStartY = e.touches[0].clientY; }, { passive: true });
  sheet.addEventListener('touchend', (e) => {
    if (e.changedTouches[0].clientY - sheetStartY > 60) container.innerHTML = '';
  }, { passive: true });

  // Backdrop dismiss
  el('depositOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) container.innerHTML = '';
  });

  // Save handler
  el('sheetSaveBtn').addEventListener('click', () => {
    const selBank = (el('sheetBankSel') as HTMLSelectElement).value;
    const amount = parseFloat((el('sheetAmount') as HTMLInputElement).value);
    const date = (el('sheetDate') as HTMLInputElement).value;
    const note = (el('sheetNote') as HTMLInputElement).value.trim();

    let valid = true;
    el('sheetBankErr').textContent = '';
    el('sheetAmountErr').textContent = '';

    if (!selBank) {
      el('sheetBankErr').textContent = 'Please select a bank.';
      valid = false;
    }
    if (!amount || amount <= 0) {
      el('sheetAmountErr').textContent = 'Enter a valid amount greater than 0.';
      valid = false;
    }
    if (!valid) return;

    if (isEdit && entry) {
      // Edit mode: mutate existing entry
      const existing = savingsData.entries.find(e => e.id === entry.id);
      if (existing) {
        existing.bankId = selBank;
        existing.amount = amount;
        existing.date = date;
        existing.note = note || undefined;
      }
    } else {
      // Add mode
      savingsData.entries.push({
        id: genId(),
        bankId: selBank,
        amount,
        date,
        note: note || undefined,
      });
    }

    saveSavings(savingsData);
    triggerHaptic();

    // Navigate carousel to the bank's card
    const bankIdx = savingsData.banks.findIndex(b => b.id === selBank);
    if (bankIdx >= 0) {
      carouselIndex = bankIdx;
    }

    container.innerHTML = '';
    renderSavings();

    // Play shimmer and confetti after render
    if (bankIdx >= 0) {
      playShimmer(selBank);
    }
    playConfetti();
  });
}

// ── Task 6: Deposit Feed ──────────────────────────────────────────────
function groupedEntries(): Array<{ label: string; entries: SavingsEntry[] }> {
  const sorted = [...savingsData.entries].sort((a, b) => b.date.localeCompare(a.date));
  const groups = new Map<string, SavingsEntry[]>();
  for (const entry of sorted) {
    const key = entry.date.slice(0, 7);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(entry);
  }
  return [...groups.entries()].map(([key, entries]) => ({
    label: formatMonthLabel(key),
    entries,
  }));
}

function formatMonthLabel(yyyyMM: string): string {
  const [y, m] = yyyyMM.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

function buildFeedHTML(): void {
  const feed = el('depositFeed');
  const banks = savingsData.banks;

  if (savingsData.entries.length === 0) {
    feed.innerHTML = '<div class="empty-msg">No deposits yet. Tap + to record your first deposit.</div>';
    return;
  }

  const groups = groupedEntries();
  let html = '';

  for (const group of groups) {
    html += `<div class="feed-month-header">${escHtml(group.label)}</div>`;
    for (const entry of group.entries) {
      const bank = banks.find(b => b.id === entry.bankId);
      const color = bank ? (bank.color || brandColor(bank.name)) : '#94a3b8';
      const bankName = bank ? bank.name : 'Unknown';
      html += `
        <div class="feed-entry" data-eid="${entry.id}">
          <div class="feed-action-edit">Edit</div>
          <div class="feed-action-delete">Delete</div>
          <div class="feed-entry-inner">
            <div style="width:4px;height:40px;border-radius:2px;background:${color};margin-right:12px;flex-shrink:0;"></div>
            <div style="flex:1;">
              <div style="font-weight:600;font-size:.9rem;color:${color};">${escHtml(bankName)}</div>
              <div style="font-size:.8rem;color:var(--text-tertiary);">${entry.date}</div>
              ${entry.note ? `<div style="font-size:.75rem;color:var(--text-secondary);font-style:italic;">${escHtml(entry.note)}</div>` : ''}
            </div>
            <div style="font-size:1rem;font-weight:700;color:var(--success);">${fmt(entry.amount)}</div>
          </div>
        </div>
      `;
    }
  }

  feed.innerHTML = html;
}

// ── Task 7: Feed swipe gestures ───────────────────────────────────────
function attachFeedGestures(): void {
  const feed = el('depositFeed');
  const entries = feed.querySelectorAll<HTMLElement>('.feed-entry');

  entries.forEach(row => {
    const inner = row.querySelector<HTMLElement>('.feed-entry-inner')!;
    const deleteBtn = row.querySelector<HTMLElement>('.feed-action-delete')!;
    const editBtn = row.querySelector<HTMLElement>('.feed-action-edit')!;

    let startX = 0;
    let startY = 0;
    let deltaX = 0;
    let cancelled = false;
    let isPointerDown = false;
    const swipeReveal = 56;
    const fullSwipeTrigger = 132;
    let actionLocked = false;

    const eid = row.dataset.eid!;

    function deleteEntry(): void {
      if (actionLocked) return;
      actionLocked = true;
      savingsData.entries = savingsData.entries.filter(e => e.id !== eid);
      saveSavings(savingsData);
      // Animate row height to 0
      row.style.transition = 'max-height 0.25s ease, opacity 0.25s ease';
      row.style.maxHeight = row.offsetHeight + 'px';
      row.style.overflow = 'hidden';
      requestAnimationFrame(() => {
        row.style.maxHeight = '0';
        row.style.opacity = '0';
        row.style.marginBottom = '0';
      });
      setTimeout(() => renderSavings(), 260);
    }

    function editEntry(): void {
      if (actionLocked) return;
      actionLocked = true;
      const entry = savingsData.entries.find(e => e.id === eid);
      if (entry) openDepositSheet(entry.bankId, entry);
    }

    function onStart(x: number, y: number): void {
      startX = x;
      startY = y;
      deltaX = 0;
      cancelled = false;
      isPointerDown = true;
      actionLocked = false;
    }

    function onMove(x: number, y: number): void {
      if (!isPointerDown || cancelled) return;
      const curX = x;
      const curY = y;
      deltaX = curX - startX;
      const deltaY = curY - startY;

      if (Math.abs(deltaY) > Math.abs(deltaX)) {
        cancelled = true;
        inner.style.transform = 'translateX(0)';
        return;
      }

      const clamped = Math.max(-swipeReveal, Math.min(swipeReveal, deltaX));
      inner.style.transform = `translateX(${clamped}px)`;
    }

    function onEnd(): void {
      if (!isPointerDown) return;
      isPointerDown = false;
      if (deltaX <= -fullSwipeTrigger) {
        deleteEntry();
        return;
      }
      if (deltaX >= fullSwipeTrigger) {
        editEntry();
        return;
      }
      if (cancelled || Math.abs(deltaX) < swipeReveal) {
        inner.style.transform = 'translateX(0)';
      } else if (deltaX <= -72) {
        inner.style.transform = `translateX(-${swipeReveal}px)`;
      } else if (deltaX >= swipeReveal) {
        inner.style.transform = `translateX(${swipeReveal}px)`;
      }
    }

    // Touch support
    row.addEventListener('touchstart', (e) => {
      onStart(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    row.addEventListener('touchmove', (e) => {
      onMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    row.addEventListener('touchend', () => onEnd(), { passive: true });

    // Mouse support (desktop/PWA windowed usage)
    row.addEventListener('mousedown', (e) => {
      onStart(e.clientX, e.clientY);
    });
    row.addEventListener('mousemove', (e) => {
      onMove(e.clientX, e.clientY);
    });
    row.addEventListener('mouseup', () => onEnd());
    row.addEventListener('mouseleave', () => onEnd());

    // Delete action
    deleteBtn.addEventListener('click', () => {
      deleteEntry();
    });

    // Edit action
    editBtn.addEventListener('click', () => {
      editEntry();
    });
  });
}

// ── Task 8: Add Bank Bottom Sheet ─────────────────────────────────────
function openAddBankSheet(): void {
  let selectedBrand: string | null = null;

  const container = el('dialogContainer');
  container.innerHTML = `
    <div class="bottom-sheet-overlay" id="addBankOverlay">
      <div class="bottom-sheet" id="addBankSheet">
        <div class="sheet-handle" id="addBankHandle"></div>
        <div class="sheet-title">Add Bank</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px;" id="brandGrid">
          ${BRAND_LIST.map(brand => {
            const color = brandColor(brand);
            return `
              <div class="brand-tile" data-brand="${escHtml(brand)}"
                style="display:flex;flex-direction:column;align-items:center;gap:6px;
                  padding:10px 6px;border-radius:10px;border:2px solid var(--border);
                  cursor:pointer;transition:border-color .15s;-webkit-tap-highlight-color:transparent;">
                <div style="width:28px;height:28px;border-radius:50%;background:${color};"></div>
                <div style="font-size:.7rem;font-weight:600;color:var(--text-secondary);text-align:center;">${escHtml(brand)}</div>
              </div>
            `;
          }).join('')}
        </div>
        <div class="sheet-field">
          <label>Bank Name</label>
          <input type="text" id="addBankName" placeholder="e.g. BDO">
          <div class="sheet-field-error" id="addBankNameErr"></div>
        </div>
        <div class="sheet-field">
          <label>Color</label>
          <input type="color" id="addBankColor" value="#94a3b8" style="height:44px;padding:4px 8px;">
        </div>
        <button class="sheet-btn" id="addBankSaveBtn"
          style="background:var(--btn-primary);color:#fff;margin-top:4px;">Add Bank</button>
      </div>
    </div>
  `;

  // Brand tile selection
  const grid = el('brandGrid');
  grid.querySelectorAll<HTMLElement>('.brand-tile').forEach(tile => {
    tile.addEventListener('click', () => {
      selectedBrand = tile.dataset.brand!;
      const color = brandColor(selectedBrand);
      (el('addBankName') as HTMLInputElement).value = selectedBrand;
      (el('addBankColor') as HTMLInputElement).value = color;
      // Highlight selected tile
      grid.querySelectorAll<HTMLElement>('.brand-tile').forEach(t => {
        t.style.borderColor = 'var(--border)';
      });
      tile.style.borderColor = color;
    });
  });

  // Drag-down dismiss
  const sheet = el('addBankSheet');
  const handle = el('addBankHandle');
  let sheetStartY = 0;
  handle.addEventListener('touchstart', (e) => { sheetStartY = e.touches[0].clientY; }, { passive: true });
  handle.addEventListener('touchend', (e) => {
    if (e.changedTouches[0].clientY - sheetStartY > 60) container.innerHTML = '';
  }, { passive: true });
  sheet.addEventListener('touchstart', (e) => { sheetStartY = e.touches[0].clientY; }, { passive: true });
  sheet.addEventListener('touchend', (e) => {
    if (e.changedTouches[0].clientY - sheetStartY > 60) container.innerHTML = '';
  }, { passive: true });

  // Backdrop dismiss
  el('addBankOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) container.innerHTML = '';
  });

  // Save handler
  el('addBankSaveBtn').addEventListener('click', () => {
    const name = (el('addBankName') as HTMLInputElement).value.trim();
    const color = (el('addBankColor') as HTMLInputElement).value;

    el('addBankNameErr').textContent = '';
    if (!name) {
      el('addBankNameErr').textContent = 'Bank name cannot be empty.';
      return;
    }

    savingsData.banks.push({ id: genId(), name, color });
    saveSavings(savingsData);
    container.innerHTML = '';
    renderSavings();
  });
}

// ── Task 9: Shimmer, confetti, haptic ─────────────────────────────────
function triggerHaptic(): void {
  navigator.vibrate?.(80);
}

function playShimmer(bankId: string): void {
  const card = el('savingsCarousel').querySelector<HTMLElement>(`[data-bid="${bankId}"]`);
  if (!card) return;
  card.classList.add('bank-card-shimmer');
  setTimeout(() => card.classList.remove('bank-card-shimmer'), 800);
}

function playConfetti(): void {
  const overlay = document.createElement('div');
  overlay.className = 'confetti-overlay';
  const colors = ['#f87171', '#fbbf24', '#4ade80', '#38bdf8', '#a78bfa', '#fb923c', '#e879f9', '#34d399'];
  for (let i = 0; i < 25; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-particle';
    const left = Math.random() * 100;
    const top = -(20 + Math.random() * 40);
    const color = colors[Math.floor(Math.random() * colors.length)];
    const duration = 0.8 + Math.random() * 0.4;
    p.style.cssText = `left:${left}vw;top:${top}px;background:${color};animation-duration:${duration}s;`;
    overlay.appendChild(p);
  }
  document.body.appendChild(overlay);
  setTimeout(() => overlay.remove(), 1200);
}

// ── Task 10: renderSavings() ──────────────────────────────────────────
function renderSavings(): void {
  buildCarouselHTML();
  syncCarouselDots();
  attachCarouselGestures();
  buildFeedHTML();
  attachFeedGestures();
}

// ── Savings Event Listeners ──────────────────────────────────────────
// (Handled via FAB and bottom sheets — see initFab(), openDepositSheet(), openAddBankSheet())

// ── Event Listeners ──────────────────────────────────────────────────

el('themeToggle').addEventListener('click', () => {
  const current = getTheme();
  setTheme(current === 'dark' ? 'light' : 'dark');
});

el('prevMonth').addEventListener('click', () => {
  slideCalendar('right', () => {
    currentMonth--;
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    selectedDay = null; render();
  });
});

el('nextMonth').addEventListener('click', () => {
  slideCalendar('left', () => {
    currentMonth++;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    selectedDay = null; render();
  });
});

// ── Swipe Gesture for Month Navigation ──────────────────────────────
function slideCalendar(direction: 'left' | 'right', then: () => void): void {
  const grid = el('calendarGrid');
  const calendarTabActive = el('tab-calendar').classList.contains('active');

  if (!calendarTabActive) {
    then();
    return;
  }

  // Slide current content out
  grid.classList.add(direction === 'left' ? 'slide-out-left' : 'slide-out-right');
  grid.addEventListener('transitionend', function handler() {
    grid.removeEventListener('transitionend', handler);
    then();
    grid.classList.remove('slide-out-left', 'slide-out-right');
    grid.classList.add(direction === 'left' ? 'slide-in-left' : 'slide-in-right');
    void grid.offsetWidth;
    grid.classList.remove('slide-in-left', 'slide-in-right');
  }, { once: true });
}

(() => {
  const calendar = el('calendarGrid');
  let startX = 0;
  let startY = 0;

  calendar.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });

  calendar.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;

    // Only trigger if horizontal swipe is dominant and long enough
    if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx)) return;

    const direction: 'left' | 'right' = dx < 0 ? 'left' : 'right';
    slideCalendar(direction, () => {
      if (dx < 0) {
        currentMonth++;
        if (currentMonth > 11) { currentMonth = 0; currentYear++; }
      } else {
        currentMonth--;
        if (currentMonth < 0) { currentMonth = 11; currentYear--; }
      }
      selectedDay = null;
      render();
    });
  }, { passive: true });
})();

el('budgetInput').addEventListener('input', () => {
  const md = getMonthData(currentYear, currentMonth);
  md.budget = parseFloat((el('budgetInput') as HTMLInputElement).value) || 0;
  save(); render();
});

el('dailyBudgetInput').addEventListener('change', () => {
  const md = getMonthData(currentYear, currentMonth);
  md.dailyBudget = parseFloat((el('dailyBudgetInput') as HTMLSelectElement).value) || 0;
  save(); render();
});

el('addExpenseBtn').addEventListener('click', () => {
  if (!selectedDay) { alert('Please select a day on the calendar first.'); return; }
  const nameInput = el('expenseName') as HTMLInputElement;
  const amountInput = el('expenseAmount') as HTMLInputElement;
  const catSelect = el('expenseCategory') as HTMLSelectElement;
  const name = nameInput.value.trim();
  const amount = parseFloat(amountInput.value);
  const category = catSelect.value;
  if (!name || !amount || amount <= 0) { alert('Enter a description and valid amount.'); return; }

  const repeatSelect = el('expenseRepeat') as HTMLSelectElement;
  const repeat = repeatSelect.value as Expense['repeat'] | '';

  const expense: Expense = {
    name, amount,
    ...(category ? { category } : {}),
    ...(repeat ? { repeat: repeat as Expense['repeat'], repeatId: genId() } : {}),
  };

  const md = getMonthData(currentYear, currentMonth);
  const dk = dayKey(currentYear, currentMonth, selectedDay);
  if (!md.expenses[dk]) md.expenses[dk] = [];
  md.expenses[dk].push(expense);

  if (repeat) {
    generateRecurring(currentYear, currentMonth, selectedDay, expense);
  }

  save();

  nameInput.value = '';
  amountInput.value = '';
  repeatSelect.value = '';
  render();
});

el('addSubBtn').addEventListener('click', () => {
  const nameInput = el('subName') as HTMLInputElement;
  const amountInput = el('subAmount') as HTMLInputElement;
  const dayInput = el('subDay') as HTMLInputElement;
  const name = nameInput.value.trim();
  const amount = parseFloat(amountInput.value);
  const dateVal = dayInput.value;
  const day = dateVal ? new Date(dateVal + 'T00:00:00').getDate() : 0;
  if (!name || !amount || amount <= 0 || !day) { alert('Enter a name, valid amount, and due date.'); return; }

  const repeatSelect = el('subRepeat') as HTMLSelectElement;
  const repeat = repeatSelect.value as Subscription['repeat'] | '';

  const sub: Subscription = {
    name, amount, day,
    ...(repeat ? { repeat: repeat as Subscription['repeat'], repeatId: genId() } : {}),
  };

  const md = getMonthData(currentYear, currentMonth);
  md.subscriptions.push(sub);

  if (repeat) {
    generateRecurringSub(currentYear, currentMonth, sub);
  }

  save();

  nameInput.value = '';
  amountInput.value = '';
  dayInput.value = '';
  repeatSelect.value = '';
  render();
});

(el('expenseAmount') as HTMLInputElement).addEventListener('keydown', (e) => {
  if (e.key === 'Enter') (el('addExpenseBtn') as HTMLButtonElement).click();
});
(el('subAmount') as HTMLInputElement).addEventListener('keydown', (e) => {
  if (e.key === 'Enter') (el('addSubBtn') as HTMLButtonElement).click();
});

// ── Tab Navigation ────────────────────────────────────────────────────
const monthNav = document.querySelector<HTMLElement>('.month-nav')!;

document.querySelectorAll<HTMLButtonElement>('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab!;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    el(`tab-${tab}`).classList.add('active');
    monthNav.style.visibility = tab === 'calendar' ? 'visible' : 'hidden';
    if (tab === 'summary') renderMonthlySummary();
    if (tab === 'savings') { renderSavings(); initFab(); }
  });
});

// ── Auth UI ──────────────────────────────────────────────────────────

function hideLoadingScreen(): void {
  const splash = document.getElementById('loadingScreen');
  if (!splash) return;
  splash.classList.add('fade-out');
  setTimeout(() => splash.remove(), 400);
}

function showAuthScreen(): void {
  el('authScreen').style.display = 'flex';
  el('appMain').style.display = 'none';
  el('authError').textContent = '';
  hideLoadingScreen();
}

function showApp(_user: User): void {
  el('authScreen').style.display = 'none';
  el('appMain').style.display = 'block';
  hideLoadingScreen();
}

el('authSubmit').addEventListener('click', async () => {
  const email = (el('authEmail') as HTMLInputElement).value.trim();
  const password = (el('authPassword') as HTMLInputElement).value;
  const mode = (el('authMode') as HTMLSelectElement).value;

  if (!email || !password) {
    el('authError').textContent = 'Please enter email and password.';
    return;
  }
  if (password.length < 6) {
    el('authError').textContent = 'Password must be at least 6 characters.';
    return;
  }

  el('authError').textContent = '';
  el('authSubmit').textContent = 'Loading...';
  (el('authSubmit') as HTMLButtonElement).disabled = true;

  const err = mode === 'signup'
    ? await signUp(email, password)
    : await signIn(email, password);

  el('authSubmit').textContent = mode === 'signup' ? 'Sign Up' : 'Log In';
  (el('authSubmit') as HTMLButtonElement).disabled = false;

  if (err) {
    el('authError').textContent = err;
    return;
  }

  if (mode === 'signup') {
    el('authError').style.color = 'var(--success)';
    el('authError').textContent = 'Account created! Check your email to confirm, then log in.';
  }
});

el('authMode').addEventListener('change', () => {
  const mode = (el('authMode') as HTMLSelectElement).value;
  el('authSubmit').textContent = mode === 'signup' ? 'Sign Up' : 'Log In';
  el('authError').textContent = '';
});

el('authPassword').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') (el('authSubmit') as HTMLButtonElement).click();
});

el('googleBtn').addEventListener('click', async () => {
  const err = await signInWithGoogle();
  if (err) el('authError').textContent = err;
});

el('logoutBtn').addEventListener('click', async () => {
  await signOut();
});

// ── Init ─────────────────────────────────────────────────────────────
const now = new Date();
currentYear = now.getFullYear();
currentMonth = now.getMonth();
selectedDay = now.getDate();

setAuthCallback(async (user: User | null) => {
  if (!user) {
    setUserId(null);
    setSavingsUserId(null);
    showAuthScreen();
    return;
  }

  setUserId(user.id);
  setSavingsUserId(user.id);
  data = await loadData();
  savingsData = await loadSavings();
  showApp(user);
  render();
});

// Safety net: if auth takes too long, hide splash and show auth screen
setTimeout(() => hideLoadingScreen(), 4000);

initAuth();

// ── Service Worker Registration ─────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
window.addEventListener('online', () => syncIfPending());
