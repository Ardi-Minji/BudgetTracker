# Design Document: Savings Tab Redesign

## Overview

This redesign replaces the current inline-form savings tab with a gesture-driven, visually rich mobile experience. The new layout consists of three stacked zones:

1. **Hero Carousel** — swipeable bank balance cards at the top
2. **FAB + Quick-Action Menu** — a fixed "+" button that expands into "Record Deposit" and "Add Bank" actions
3. **Deposit Feed** — a scrollable, month-grouped list of all deposit entries with swipe-to-delete and swipe-to-edit

All changes are confined to the savings tab. The existing `SavingsStore`, `Bank`, `SavingsEntry` types, `saveSavings()`, and `loadSavings()` remain untouched.

---

## Architecture

The feature is implemented entirely within the existing no-framework architecture:

- **HTML structure** (`index.html`): The `#tab-savings` pane is replaced with new semantic markup for the carousel, FAB, and feed.
- **CSS** (`index.html <style>`): New CSS variables and rule blocks are appended to the existing style block.
- **Logic** (`src/main.ts`): `renderSavings()` is rewritten. New helper functions handle carousel state, bottom-sheet lifecycle, swipe gesture tracking, and animations.
- **No new files** are introduced; all code lives in the existing two files.

### State additions (module-level in main.ts)

```
carouselIndex: number          // currently visible card index (0 = Total_Card)
openSheetType: 'deposit' | 'addbank' | null
editingEntryId: string | null  // non-null when editing an existing entry
```

### Rendering flow

```
renderSavings()
  ├── buildCarouselHTML()      → writes #savingsCarousel innerHTML
  ├── attachCarouselGestures() → touch/mouse drag handlers
  ├── buildFeedHTML()          → writes #depositFeed innerHTML
  ├── attachFeedGestures()     → per-row swipe handlers
  └── syncCarouselDots()       → updates dot indicators
```

Bottom sheets are rendered into the existing `#dialogContainer` element (same pattern as the recurring-delete sheet).

---

## Components and Interfaces

### 1. Hero Carousel

**Markup skeleton:**
```html
<div class="savings-carousel-wrap">
  <div class="savings-carousel" id="savingsCarousel">
    <!-- Total_Card + one Bank_Card per bank -->
  </div>
  <div class="carousel-dots" id="carouselDots"></div>
</div>
```

**Card count:** `1 + banks.length` (Total_Card is always index 0).

**Swipe mechanics:**
- Listen to `touchstart`/`touchend` (and `mousedown`/`mouseup` for desktop).
- On release, if `|deltaX| > 40px`, advance or retreat `carouselIndex` by 1 (clamped to valid range).
- Apply `transform: translateX(-${carouselIndex * 100}%)` on the inner track with `transition: transform 0.3s ease`.

**Tapping a Bank_Card** calls `openDepositSheet(bankId)` — pre-fills the bank selector.

**Brand colors** are stored as a lookup map keyed by lowercase bank name:

```ts
const BRAND_COLORS: Record<string, string> = {
  bdo: '#CC0000', bpi: '#003087', metrobank: '#003087',
  unionbank: '#0033A0', gotyme: '#00C389', maya: '#00B4D8',
  gcash: '#007DFF', wise: '#9FE870', other: '#94a3b8',
};
```

> Note: Requirement 2.5 mentions logo images; per the confirmed design decision, brand colors + text labels are used instead of external logo images.

### 2. FAB and Quick-Action Menu

**Markup:**
```html
<div class="savings-fab-wrap" id="savingsFabWrap">
  <div class="fab-menu" id="fabMenu" hidden>
    <button class="fab-action" id="fabDeposit">💰 Record Deposit</button>
    <button class="fab-action" id="fabAddBank">🏦 Add Bank</button>
  </div>
  <button class="fab" id="savingsFab" aria-label="Quick actions">＋</button>
</div>
```

**Behavior:**
- FAB tap toggles `fabMenu` visibility and rotates the "+" icon 45° via CSS class.
- Click outside (`document` click listener, stopped at `savingsFabWrap`) collapses the menu.
- FAB is `position: fixed` inside the savings tab context; z-index above the feed but below `#dialogContainer`.

### 3. Deposit Entry Bottom Sheet

Rendered into `#dialogContainer` using the existing `.bottom-sheet-overlay` / `.bottom-sheet` CSS classes.

**Fields:**
- Bank selector `<select>` (pre-populated from `savingsData.banks`)
- Amount `<input type="number">` (min 0.01, step 0.01)
- Date `<input type="date">` (defaults to today's ISO date)
- Note `<input type="text">` (optional)

**Validation:** bank must be selected AND amount > 0. Inline error message shown below the offending field; sheet stays open.

**On success:**
1. Push new `SavingsEntry` to `savingsData.entries`
2. Call `saveSavings(savingsData)`
3. Call `navigator.vibrate?.(80)`
4. Animate carousel to the saved bank's card index
5. Play shimmer on that Bank_Card
6. Play confetti burst
7. Close sheet
8. Call `renderSavings()`

**Edit mode:** same sheet, pre-populated; on save, mutate the existing entry in-place.

**Dismissal:** drag-down gesture (touchstart/touchmove on `.bottom-sheet`, if `deltaY > 60` close) or backdrop tap.

### 4. Add Bank Bottom Sheet

Same `.bottom-sheet` pattern.

**Brand picker grid:** 3-column CSS grid of brand tiles (BDO, BPI, Metrobank, UnionBank, GoTyme, Maya, GCash, Wise, Other). Each tile shows the brand color as a swatch circle and the brand name as a text label. Selecting a tile auto-fills the name input and sets the color.

**Color picker:** `<input type="color">` pre-set to the selected brand's canonical color; user can override.

**Validation:** name must be non-empty after trim.

**On success:**
1. Push new `Bank` to `savingsData.banks`
2. Call `saveSavings(savingsData)`
3. Close sheet
4. Call `renderSavings()` — carousel updates to include the new card

### 5. Deposit Feed

**Markup:**
```html
<div class="deposit-feed" id="depositFeed"></div>
```

Entries are sorted descending by `date`. They are grouped by `YYYY-MM` and rendered with sticky month headers:

```html
<div class="feed-month-group">
  <div class="feed-month-header">July 2025</div>
  <div class="feed-entry" data-eid="...">
    <div class="feed-entry-inner">
      <!-- bank accent bar, name, amount, date, optional note -->
    </div>
    <div class="feed-action-delete">Delete</div>
    <div class="feed-action-edit">Edit</div>
  </div>
</div>
```

**Sticky headers:** `.feed-month-header { position: sticky; top: 0; }` within the scrollable `.tab-content`.

**Swipe gestures (per entry):**
- Track `touchstart`/`touchmove`/`touchend` on `.feed-entry`.
- If `|deltaY| > |deltaX|` at any point during the gesture, cancel horizontal tracking (vertical scroll wins).
- On release:
  - `deltaX < -72px` → snap to reveal delete action (translate entry `-72px`)
  - `deltaX > +72px` → snap to reveal edit action (translate entry `+72px`)
  - Otherwise → snap back to 0
- Tapping the revealed delete button: remove entry, animate row height to 0, then remove from DOM and update store.
- Tapping the revealed edit button: open deposit sheet pre-filled with entry data.

### 6. Animations

**Shimmer (CSS keyframe):**
```css
@keyframes shimmer {
  0%   { background-position: -200% center; }
  100% { background-position: 200% center; }
}
.bank-card-shimmer {
  background: linear-gradient(90deg, transparent 25%, rgba(255,255,255,0.3) 50%, transparent 75%);
  background-size: 200% 100%;
  animation: shimmer 0.7s ease forwards;
}
```
Class is added then removed after 800ms via `setTimeout`.

**Confetti (CSS + JS):**
- On save, inject 20–30 `<div class="confetti-particle">` elements into a fixed overlay div (`pointer-events: none`).
- Each particle gets a random color, random `left` position, and a CSS animation (`fall` keyframe: translate down + rotate + fade out) with a random duration between 0.8s–1.2s.
- The overlay is removed after 1200ms.
- The overlay has `pointer-events: none` so it never blocks interaction.

---

## Data Models

No changes to existing types. All new state is ephemeral (UI-only).

### Derived computations

```ts
// Bank balance
function bankBalance(bankId: string): number {
  return savingsData.entries
    .filter(e => e.bankId === bankId)
    .reduce((sum, e) => sum + e.amount, 0);
}

// Total savings
function totalSavings(): number {
  return savingsData.entries.reduce((sum, e) => sum + e.amount, 0);
}

// Entries grouped by month, sorted descending
function groupedEntries(): Array<{ label: string; entries: SavingsEntry[] }> {
  const sorted = [...savingsData.entries].sort((a, b) => b.date.localeCompare(a.date));
  const groups = new Map<string, SavingsEntry[]>();
  for (const entry of sorted) {
    const key = entry.date.slice(0, 7); // YYYY-MM
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
```

### Brand color lookup

```ts
const BRAND_COLORS: Record<string, string> = {
  bdo: '#CC0000',
  bpi: '#003087',
  metrobank: '#003087',
  unionbank: '#0033A0',
  gotyme: '#00C389',
  maya: '#00B4D8',
  gcash: '#007DFF',
  wise: '#9FE870',
  other: '#94a3b8',
};

const BRAND_LIST = ['BDO','BPI','Metrobank','UnionBank','GoTyme','Maya','GCash','Wise','Other'];

function brandColor(name: string): string {
  return BRAND_COLORS[name.toLowerCase()] ?? '#94a3b8';
}
```

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Total savings balance

*For any* `SavingsStore`, `totalSavings()` should equal `entries.reduce((s, e) => s + e.amount, 0)`.

**Validates: Requirements 1.3**

---

### Property 2: Per-bank balance

*For any* `SavingsStore` and any `bankId`, `bankBalance(bankId)` should equal the sum of `amount` for all entries where `entry.bankId === bankId`.

**Validates: Requirements 2.4**

---

### Property 3: Carousel card count

*For any* `SavingsStore`, the number of cards in the Hero_Carousel should equal `1 + banks.length` (the Total_Card plus one card per bank), and the first card should always be the Total_Card.

**Validates: Requirements 1.2, 2.1, 8.6**

---

### Property 4: Deposit addition round-trip

*For any* valid deposit input (non-empty `bankId`, `amount > 0`, valid ISO date), after calling the add-deposit handler the entry should be present in `SavingsStore.entries` with matching `bankId`, `amount`, `date`, and `note`.

**Validates: Requirements 4.3**

---

### Property 5: Invalid deposit is rejected

*For any* deposit submission where `bankId` is empty or `amount ≤ 0`, `SavingsStore.entries.length` should remain unchanged.

**Validates: Requirements 4.4**

---

### Property 6: Feed is sorted descending by date

*For any* `SavingsStore`, `groupedEntries()` should return entries in descending date order (newest first) across all groups.

**Validates: Requirements 5.1**

---

### Property 7: Feed grouping correctness

*For any* `SavingsStore`, every entry returned in a group with key `YYYY-MM` should have a `date` whose first seven characters equal `YYYY-MM`, and `formatMonthLabel("YYYY-MM")` should return `"<FullMonthName> YYYY"`.

**Validates: Requirements 5.2**

---

### Property 8: Entry rendering completeness

*For any* `SavingsEntry` and its associated `Bank`, the rendered feed row HTML should contain the bank name, the ₱-formatted amount, the date string, and — when `note` is non-empty — the note text.

**Validates: Requirements 5.4, 5.5**

---

### Property 9: Delete removes exactly one entry

*For any* `SavingsStore` with `n` entries and any entry `e`, after deleting `e` the `entries` array should have length `n - 1` and should not contain any entry with `id === e.id`.

**Validates: Requirements 6.2**

---

### Property 10: Edit updates entry in-place

*For any* `SavingsStore` and any entry `e`, after editing `e` with new valid values the `entries` array should have the same length, and the entry with `id === e.id` should reflect the new `amount`, `date`, and `note` values.

**Validates: Requirements 7.3**

---

### Property 11: Add bank round-trip

*For any* non-empty bank name (after trim), after calling the add-bank handler `SavingsStore.banks` should contain a bank whose `name` equals the trimmed input.

**Validates: Requirements 8.4**

---

### Property 12: Empty bank name is rejected

*For any* string composed entirely of whitespace characters, calling the add-bank handler should leave `SavingsStore.banks.length` unchanged.

**Validates: Requirements 8.5**

---

### Property 13: Brand picker auto-fills name and color

*For any* brand in `BRAND_LIST`, selecting that brand should set the name field to the brand's display name and the color field to `BRAND_COLORS[brand.toLowerCase()]`.

**Validates: Requirements 8.3**

---

### Property 14: Swipe threshold decision

*For any* horizontal swipe gesture, if `|deltaX| >= 72` the action (delete or edit) should be revealed; if `|deltaX| < 72` the entry should snap back to `translateX(0)`. Additionally, if at any point during the gesture `|deltaY| > |deltaX|`, the horizontal tracking should be cancelled regardless of `deltaX`.

**Validates: Requirements 6.1, 6.3, 7.1, 7.4, 6.4**

---

### Property 15: Carousel navigates to saved bank on deposit

*For any* deposit saved to a bank at carousel index `i`, after the save handler completes `carouselIndex` should equal `i`.

**Validates: Requirements 10.5**

---

### Property 16: Haptic is safe when vibrate is unavailable

*For any* call to the haptic helper function when `navigator.vibrate` is `undefined`, the function should complete without throwing an error.

**Validates: Requirements 9.2**

---

## Error Handling

| Scenario | Handling |
|---|---|
| Deposit submitted with no bank | Inline error below bank selector; sheet stays open |
| Deposit submitted with amount ≤ 0 | Inline error below amount input; sheet stays open |
| Add Bank submitted with empty name | Inline error below name input; sheet stays open |
| `navigator.vibrate` not available | Optional chaining `navigator.vibrate?.(80)` — silent no-op |
| `saveSavings` / localStorage failure | Errors are not currently caught by the existing layer; no change in scope |
| Swipe gesture cancelled by vertical scroll | Horizontal tracking is cancelled; entry snaps back |
| Confetti overlay not cleaned up | `setTimeout` at 1200ms removes the overlay element unconditionally |

---

## Testing Strategy

### Dual approach

Both unit tests and property-based tests are required. They are complementary:

- **Unit tests** cover specific examples, integration points, and edge cases.
- **Property-based tests** verify universal invariants across randomly generated inputs.

### Unit tests (examples and edge cases)

- Rendering Total_Card with zero banks shows ₱0.00 and the "add a bank" prompt
- Rendering feed with no entries shows the empty-state message
- Tapping a Bank_Card opens the deposit sheet pre-filled with that bank
- Submitting the deposit form with no bank selected shows an inline error and does not close the sheet
- Submitting the deposit form with amount = 0 shows an inline error
- Submitting a valid deposit closes the sheet and the new entry appears in the feed
- Submitting the Add Bank form with a whitespace-only name shows an inline error
- Selecting a brand tile auto-fills the name and color fields
- Left-swipe below 72px threshold snaps the entry back
- Left-swipe beyond 72px reveals the delete button
- Right-swipe beyond 72px reveals the edit button
- Vertical scroll cancels an in-progress horizontal swipe

### Property-based tests

Use a property-based testing library appropriate for TypeScript (e.g., **fast-check**).

Each property test must run a minimum of **100 iterations**.

Each test must include a comment tag in the format:
`// Feature: savings-tab-redesign, Property <N>: <property_text>`

| Property | Test description |
|---|---|
| P1 | For any entries array, `totalSavings()` equals `entries.reduce((s,e) => s+e.amount, 0)` |
| P2 | For any bank and entries, `bankBalance(bankId)` equals sum of entries filtered by that bankId |
| P3 | For any banks array, carousel card count equals `1 + banks.length` and first card is Total_Card |
| P4 | For any valid deposit input, after `addDeposit()` the entry is present in `entries` with matching fields |
| P5 | For any invalid deposit (no bank or amount ≤ 0), `entries.length` is unchanged |
| P6 | For any entries array, `groupedEntries()` returns entries in descending date order |
| P7 | For any entries array, every entry in a group has a date matching that group's YYYY-MM key; `formatMonthLabel` returns correct format |
| P8 | For any entry and its bank, rendered row HTML contains bank name, ₱-formatted amount, date, and note when present |
| P9 | For any entries array and any entry id, after delete the array is shorter by 1 and does not contain that id |
| P10 | For any entries array and any entry, after edit the array length is unchanged and the entry reflects new values |
| P11 | For any non-empty bank name, after `addBank()` the bank is present in `banks` |
| P12 | For any whitespace-only string, `addBank()` leaves `banks` unchanged |
| P13 | For any brand in BRAND_LIST, selecting it sets name and color to the brand's canonical values |
| P14 | For any swipe gesture, threshold ≥ 72px reveals action; < 72px snaps back; vertical-dominant gesture cancels horizontal |
| P15 | For any deposit saved to bank at index i, `carouselIndex` equals i after save |
| P16 | For any call to haptic helper with `navigator.vibrate` undefined, no exception is thrown |
