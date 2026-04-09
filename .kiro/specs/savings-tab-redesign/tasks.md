# Implementation Plan: Savings Tab Redesign

## Overview

Rewrite the savings tab in-place across `index.html` (markup + CSS) and `src/main.ts` (logic). No new files are introduced. All changes are additive to the existing no-framework architecture.

## Tasks

- [x] 1. Replace `#tab-savings` markup and add CSS foundations
  - Replace the existing `#tab-savings` pane content in `index.html` with the new semantic skeleton: `.savings-carousel-wrap`, `.savings-fab-wrap`, and `#depositFeed`
  - Add CSS variables and rule blocks for carousel, FAB, feed, bottom-sheet fields, and animations (shimmer, confetti, swipe actions) to the existing `<style>` block
  - _Requirements: 1.1, 3.1, 3.6, 5.1_

- [x] 2. Implement carousel rendering and gesture navigation
  - [x] 2.1 Implement `buildCarouselHTML()` and `syncCarouselDots()`
    - Render Total_Card (index 0) showing `totalSavings()` formatted as ₱ with two decimal places; show "add a bank" prompt when `banks.length === 0`
    - Render one Bank_Card per bank showing name, `bankBalance(bankId)`, and brand color accent
    - Render dot indicators reflecting `carouselIndex`
    - _Requirements: 1.2, 1.3, 1.4, 2.1, 2.3, 2.4_

  - [x] 2.2 Implement `attachCarouselGestures()`
    - Handle `touchstart`/`touchend` and `mousedown`/`mouseup`; advance/retreat `carouselIndex` when `|deltaX| > 40px`; apply `transform: translateX` with `transition: transform 0.3s ease`
    - Tapping a Bank_Card calls `openDepositSheet(bankId)`
    - _Requirements: 2.2, 2.6, 4.2_

  - [ ]* 2.3 Write property test for carousel card count (Property 3)
    - **Property 3: For any banks array, carousel card count equals `1 + banks.length` and first card is Total_Card**
    - **Validates: Requirements 1.2, 2.1, 8.6**

  - [ ]* 2.4 Write property tests for balance computations (Properties 1 & 2)
    - **Property 1: `totalSavings()` equals `entries.reduce((s,e) => s+e.amount, 0)`**
    - **Property 2: `bankBalance(bankId)` equals sum of entries filtered by that bankId**
    - **Validates: Requirements 1.3, 2.4**

- [x] 3. Implement FAB and Quick-Action Menu
  - Wire `#savingsFab` toggle: show/hide `#fabMenu`, rotate "+" icon 45° via CSS class
  - Add `document` click listener to collapse menu when clicking outside `#savingsFabWrap`
  - Wire `#fabDeposit` → `openDepositSheet(null)` and `#fabAddBank` → `openAddBankSheet()`
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 4. Implement Deposit Entry Bottom Sheet
  - [x] 4.1 Implement `openDepositSheet(bankId: string | null, entry?: SavingsEntry)`
    - Render sheet into `#dialogContainer` with bank `<select>`, amount, date (default today), and note fields
    - Pre-populate bank selector when `bankId` is provided; pre-fill all fields when `entry` is provided (edit mode)
    - Attach drag-down dismiss (`deltaY > 60`) and backdrop-tap dismiss
    - _Requirements: 4.1, 4.2, 4.6, 7.2_

  - [x] 4.2 Implement deposit save handler
    - Validate: bank selected AND amount > 0; show inline error and keep sheet open on failure
    - On success: push/mutate `SavingsEntry`, call `saveSavings(savingsData)`, call `navigator.vibrate?.(80)`, animate carousel to bank index, play shimmer + confetti, close sheet, call `renderSavings()`
    - _Requirements: 4.3, 4.4, 4.5, 7.3, 9.1, 9.2, 10.1, 10.5_

  - [ ]* 4.3 Write property test for deposit addition round-trip (Property 4)
    - **Property 4: For any valid deposit input, after `addDeposit()` the entry is present in `entries` with matching fields**
    - **Validates: Requirements 4.3**

  - [ ]* 4.4 Write property test for invalid deposit rejection (Property 5)
    - **Property 5: For any invalid deposit (no bank or amount ≤ 0), `entries.length` is unchanged**
    - **Validates: Requirements 4.4**

- [ ] 5. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement Deposit Feed rendering
  - [x] 6.1 Implement `groupedEntries()`, `formatMonthLabel()`, and `buildFeedHTML()`
    - Sort entries descending by date; group by `YYYY-MM`; render sticky `.feed-month-header` per group
    - Each `.feed-entry` row shows bank name with brand color accent bar, ₱-formatted amount, date, and note when present
    - Render empty-state message when `entries.length === 0`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [ ]* 6.2 Write property test for feed sort order (Property 6)
    - **Property 6: For any entries array, `groupedEntries()` returns entries in descending date order**
    - **Validates: Requirements 5.1**

  - [ ]* 6.3 Write property test for feed grouping correctness (Property 7)
    - **Property 7: Every entry in a group has a date matching that group's YYYY-MM key; `formatMonthLabel` returns correct format**
    - **Validates: Requirements 5.2**

  - [ ]* 6.4 Write property test for entry rendering completeness (Property 8)
    - **Property 8: For any entry and its bank, rendered row HTML contains bank name, ₱-formatted amount, date, and note when present**
    - **Validates: Requirements 5.4, 5.5**

- [x] 7. Implement swipe-to-delete and swipe-to-edit on feed entries
  - [x] 7.1 Implement `attachFeedGestures()`
    - Track `touchstart`/`touchmove`/`touchend` per `.feed-entry`; cancel horizontal tracking when `|deltaY| > |deltaX|`
    - Snap to reveal delete (`deltaX < -72px`) or edit (`deltaX > +72px`); snap back otherwise
    - _Requirements: 6.1, 6.3, 6.4, 7.1, 7.4_

  - [x] 7.2 Wire delete and edit actions
    - Delete tap: remove entry from `savingsData.entries`, call `saveSavings`, animate row height to 0, remove from DOM, call `renderSavings()`
    - Edit tap: call `openDepositSheet(entry.bankId, entry)`
    - _Requirements: 6.2, 7.2_

  - [ ]* 7.3 Write property test for delete removes exactly one entry (Property 9)
    - **Property 9: For any entries array and any entry id, after delete the array is shorter by 1 and does not contain that id**
    - **Validates: Requirements 6.2**

  - [ ]* 7.4 Write property test for edit updates entry in-place (Property 10)
    - **Property 10: For any entries array and any entry, after edit the array length is unchanged and the entry reflects new values**
    - **Validates: Requirements 7.3**

  - [ ]* 7.5 Write property test for swipe threshold decision (Property 14)
    - **Property 14: threshold ≥ 72px reveals action; < 72px snaps back; vertical-dominant gesture cancels horizontal**
    - **Validates: Requirements 6.1, 6.3, 7.1, 7.4, 6.4**

- [x] 8. Implement Add Bank Bottom Sheet
  - [x] 8.1 Implement `openAddBankSheet()`
    - Render sheet with 3-column brand picker grid (BDO, BPI, Metrobank, UnionBank, GoTyme, Maya, GCash, Wise, Other) showing color swatch + label
    - Selecting a tile auto-fills name input and sets `<input type="color">` to brand's canonical color
    - Attach drag-down and backdrop-tap dismiss
    - _Requirements: 8.1, 8.2, 8.3_

  - [x] 8.2 Implement add-bank save handler
    - Validate: name non-empty after trim; show inline error on failure
    - On success: push new `Bank` to `savingsData.banks`, call `saveSavings(savingsData)`, close sheet, call `renderSavings()`
    - _Requirements: 8.4, 8.5, 8.6_

  - [ ]* 8.3 Write property test for add bank round-trip (Property 11)
    - **Property 11: For any non-empty bank name, after `addBank()` the bank is present in `banks`**
    - **Validates: Requirements 8.4**

  - [ ]* 8.4 Write property test for empty bank name rejection (Property 12)
    - **Property 12: For any whitespace-only string, `addBank()` leaves `banks` unchanged**
    - **Validates: Requirements 8.5**

  - [ ]* 8.5 Write property test for brand picker auto-fill (Property 13)
    - **Property 13: For any brand in BRAND_LIST, selecting it sets name and color to the brand's canonical values**
    - **Validates: Requirements 8.3**

- [x] 9. Implement shimmer, confetti, and haptic helpers
  - Implement `playShimmer(bankId)`: add `.bank-card-shimmer` class to the bank's card element, remove after 800ms via `setTimeout`
  - Implement `playConfetti()`: inject 20–30 `.confetti-particle` divs into a fixed `pointer-events: none` overlay; remove overlay after 1200ms
  - Implement `triggerHaptic()`: call `navigator.vibrate?.(80)` — safe no-op when unavailable
  - _Requirements: 9.1, 9.2, 10.1, 10.2, 10.3, 10.4_

  - [ ]* 9.1 Write property test for haptic safety (Property 16)
    - **Property 16: When `navigator.vibrate` is undefined, `triggerHaptic()` completes without throwing**
    - **Validates: Requirements 9.2**

  - [ ]* 9.2 Write property test for carousel navigation to saved bank (Property 15)
    - **Property 15: For any deposit saved to bank at index i, `carouselIndex` equals i after save**
    - **Validates: Requirements 10.5**

- [x] 10. Wire `renderSavings()` and integrate module-level state
  - Add `carouselIndex`, `openSheetType`, and `editingEntryId` as module-level state in `main.ts`
  - Implement `renderSavings()` to call `buildCarouselHTML()`, `attachCarouselGestures()`, `buildFeedHTML()`, `attachFeedGestures()`, and `syncCarouselDots()` in sequence
  - Ensure `renderSavings()` is called on tab switch to savings and after every data mutation
  - _Requirements: 1.1, 2.1, 5.1, 8.6_

- [ ] 11. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests use fast-check; each must run ≥ 100 iterations and include a comment tag: `// Feature: savings-tab-redesign, Property <N>: <property_text>`
- All code lives in `index.html` and `src/main.ts` — no new files
