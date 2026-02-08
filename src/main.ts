import type { BudgetStore, MonthData, MonthSummary, YearSummary } from './types';
import { initAuth, setAuthCallback, signIn, signUp, signInWithGoogle, signOut } from './auth';
import { loadData, saveData, setUserId } from './store';
import type { User } from '@supabase/supabase-js';

// ── Helpers ──────────────────────────────────────────────────────────
const el = (id: string): HTMLElement => document.getElementById(id)!;

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

function escHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
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

function save(): void {
  saveData(data);
}

function getMonthData(y: number, m: number): MonthData {
  const key = monthKey(y, m);
  if (!data[key]) data[key] = { budget: 0, subscriptions: [], expenses: {} };
  return data[key];
}

// ── Init sub day dropdown ────────────────────────────────────────────
function initSubDaySelect(): void {
  const sel = el('subDay') as HTMLSelectElement;
  sel.innerHTML = '';
  for (let i = 1; i <= 31; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `Day ${i}`;
    sel.appendChild(opt);
  }
}

// ── Calendar Render ──────────────────────────────────────────────────
function render(): void {
  const md = getMonthData(currentYear, currentMonth);
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === currentYear && today.getMonth() === currentMonth;

  el('monthLabel').textContent = `${MONTH_NAMES[currentMonth]} ${currentYear}`;
  (el('budgetInput') as HTMLInputElement).value = md.budget ? String(md.budget) : '';

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
    if (dayTotal > 0) html += `<div class="day-total">-${fmt(dayTotal)}</div>`;
    if (subTotal > 0) html += `<div class="day-sub">${fmt(subTotal)}</div>`;

    if (dayExpenses.length > 0 || daySubs.length > 0) {
      html += '<div class="dot-row">';
      for (let i = 0; i < Math.min(dayExpenses.length, 5); i++) html += '<div class="dot"></div>';
      for (let i = 0; i < Math.min(daySubs.length, 3); i++) html += '<div class="dot sub"></div>';
      html += '</div>';
    }

    div.innerHTML = html;
    const dayNum = d;
    div.addEventListener('click', () => { selectedDay = dayNum; render(); });
    grid.appendChild(div);
  }

  // Summary card calculations
  let totalExpenses = 0;
  for (const dk in md.expenses) {
    totalExpenses += (md.expenses[dk] || []).reduce((s, e) => s + e.amount, 0);
  }

  const totalSubAmount = md.subscriptions.reduce((s, sub) => s + sub.amount, 0);
  const totalSpent = totalExpenses + totalSubAmount;
  const remaining = (md.budget || 0) - totalSpent;
  const pct = md.budget > 0 ? Math.max(0, Math.min(100, (remaining / md.budget) * 100)) : 100;

  el('totalSpent').textContent = fmt(totalExpenses);
  el('totalSubs').textContent = fmt(totalSubAmount);

  const remEl = el('remaining');
  remEl.textContent = (remaining < 0 ? '-' : '') + fmt(remaining);
  remEl.className = 'value ' + (remaining >= 0 ? 'green' : 'red');

  const bar = el('progressBar');
  bar.style.width = pct + '%';
  bar.style.background = pct > 40 ? '#4ade80' : pct > 15 ? '#fbbf24' : '#f87171';

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
      <span class="name">${escHtml(e.name)}</span>
      <span class="amount">-${fmt(e.amount)}</span>
      <button class="del-btn" data-idx="${i}" data-dk="${dk}">&times;</button>
    </div>
  `).join('');

  list.querySelectorAll<HTMLButtonElement>('.del-btn').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const idx = parseInt(btn.dataset.idx!);
      const key = btn.dataset.dk!;
      md.expenses[key].splice(idx, 1);
      if (md.expenses[key].length === 0) delete md.expenses[key];
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
    <div class="sub-item">
      <div class="info">${escHtml(s.name)}<small>Due: Day ${s.day}</small></div>
      <span class="amount">${fmt(s.amount)}</span>
      <button class="del-btn" data-idx="${i}">&times;</button>
    </div>
  `).join('');

  list.querySelectorAll<HTMLButtonElement>('.del-btn').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      md.subscriptions.splice(parseInt(btn.dataset.idx!), 1);
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
  for (let m = 0; m < 12; m++) {
    allKeys.add(monthKey(currentYear, m));
  }

  const byYear = new Map<number, MonthSummary[]>();
  for (const key of allKeys) {
    const ms = computeMonthSummary(key);
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
    ? '<span class="status-badge under">Under Budget</span>'
    : '<span class="status-badge over">Over Budget</span>';
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

  // ── Desktop: month row → navigate ──
  body.querySelectorAll<HTMLTableRowElement>('.month-row').forEach(row => {
    row.addEventListener('click', () => {
      currentYear = parseInt(row.dataset.y!);
      currentMonth = parseInt(row.dataset.m!);
      selectedDay = null;
      render();
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

  // ── Mobile: month card → navigate ──
  mobileWrap.querySelectorAll<HTMLElement>('.month-card').forEach(card => {
    card.addEventListener('click', () => {
      currentYear = parseInt(card.dataset.y!);
      currentMonth = parseInt(card.dataset.m!);
      selectedDay = null;
      render();
    });
  });

  // Grand totals
  const grandRemaining = grandBudget - grandExpenses - grandSubs;
  el('summaryTotals').innerHTML = `
    <div class="st-card">
      <div class="st-label">Total Budget (All Time)</div>
      <div class="st-value" style="color:#38bdf8;">${fmt(grandBudget)}</div>
    </div>
    <div class="st-card">
      <div class="st-label">Total Daily Expenses</div>
      <div class="st-value" style="color:#f87171;">${fmt(grandExpenses)}</div>
    </div>
    <div class="st-card">
      <div class="st-label">Total Subscriptions</div>
      <div class="st-value" style="color:#a78bfa;">${fmt(grandSubs)}</div>
    </div>
    <div class="st-card">
      <div class="st-label">Overall Remaining</div>
      <div class="st-value" style="color:${grandRemaining >= 0 ? '#4ade80' : '#f87171'};">${grandRemaining < 0 ? '-' : ''}${fmt(grandRemaining)}</div>
    </div>
  `;
}

// ── Event Listeners ──────────────────────────────────────────────────

el('prevMonth').addEventListener('click', () => {
  currentMonth--;
  if (currentMonth < 0) { currentMonth = 11; currentYear--; }
  selectedDay = null; render();
});

el('nextMonth').addEventListener('click', () => {
  currentMonth++;
  if (currentMonth > 11) { currentMonth = 0; currentYear++; }
  selectedDay = null; render();
});

el('budgetInput').addEventListener('input', () => {
  const md = getMonthData(currentYear, currentMonth);
  md.budget = parseFloat((el('budgetInput') as HTMLInputElement).value) || 0;
  save(); render();
});

el('addExpenseBtn').addEventListener('click', () => {
  if (!selectedDay) { alert('Please select a day on the calendar first.'); return; }
  const nameInput = el('expenseName') as HTMLInputElement;
  const amountInput = el('expenseAmount') as HTMLInputElement;
  const name = nameInput.value.trim();
  const amount = parseFloat(amountInput.value);
  if (!name || !amount || amount <= 0) { alert('Enter a description and valid amount.'); return; }

  const md = getMonthData(currentYear, currentMonth);
  const dk = dayKey(currentYear, currentMonth, selectedDay);
  if (!md.expenses[dk]) md.expenses[dk] = [];
  md.expenses[dk].push({ name, amount });
  save();

  nameInput.value = '';
  amountInput.value = '';
  render();
});

el('addSubBtn').addEventListener('click', () => {
  const nameInput = el('subName') as HTMLInputElement;
  const amountInput = el('subAmount') as HTMLInputElement;
  const daySelect = el('subDay') as HTMLSelectElement;
  const name = nameInput.value.trim();
  const amount = parseFloat(amountInput.value);
  const day = parseInt(daySelect.value);
  if (!name || !amount || amount <= 0) { alert('Enter a name and valid amount.'); return; }

  const md = getMonthData(currentYear, currentMonth);
  md.subscriptions.push({ name, amount, day });
  save();

  nameInput.value = '';
  amountInput.value = '';
  render();
});

(el('expenseAmount') as HTMLInputElement).addEventListener('keydown', (e) => {
  if (e.key === 'Enter') (el('addExpenseBtn') as HTMLButtonElement).click();
});
(el('subAmount') as HTMLInputElement).addEventListener('keydown', (e) => {
  if (e.key === 'Enter') (el('addSubBtn') as HTMLButtonElement).click();
});

el('summaryToggle').addEventListener('click', () => {
  const wrap = el('summaryWrap');
  const arrow = el('summaryArrow');
  wrap.classList.toggle('open');
  arrow.classList.toggle('open');
  if (wrap.classList.contains('open')) renderMonthlySummary();
});

// ── Auth UI ──────────────────────────────────────────────────────────

function showAuthScreen(): void {
  el('authScreen').style.display = 'flex';
  el('appMain').style.display = 'none';
  el('authError').textContent = '';
}

function showApp(user: User): void {
  el('authScreen').style.display = 'none';
  el('appMain').style.display = 'block';
  el('userEmail').textContent = user.email ?? '';
  el('userBar').style.display = 'flex';
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
    el('authError').style.color = '#4ade80';
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
initSubDaySelect();

const now = new Date();
currentYear = now.getFullYear();
currentMonth = now.getMonth();
selectedDay = now.getDate();

setAuthCallback(async (user: User | null) => {
  if (!user) {
    setUserId(null);
    showAuthScreen();
    return;
  }

  setUserId(user.id);
  data = await loadData();
  showApp(user);
  render();
});

initAuth();
