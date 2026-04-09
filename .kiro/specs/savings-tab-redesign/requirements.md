# Requirements Document

## Introduction

This feature redesigns the Savings tab of a mobile-first PWA budget tracker (TypeScript + Vite, no framework). The redesign replaces the current inline-form layout with a swipeable hero card carousel, a FAB-driven quick-action menu, a swipeable recent-deposits feed with sticky month headers, a bottom-sheet Add Bank flow with Philippine bank/wallet brand logos, and haptic + animation feedback on successful deposit recording.

The existing data model (`Bank`, `SavingsEntry`, `SavingsStore`) and Supabase sync layer remain unchanged.

---

## Glossary

- **Savings_Tab**: The "Savings" pane within the bottom-nav tab layout of the app.
- **Hero_Carousel**: The horizontally swipeable card area at the top of the Savings_Tab showing bank balance cards.
- **Total_Card**: The first card in the Hero_Carousel displaying the aggregate sum of all bank balances.
- **Bank_Card**: A card in the Hero_Carousel representing a single bank/wallet and its current balance.
- **FAB**: Floating Action Button — the "+" button fixed at the bottom-right of the Savings_Tab.
- **Quick_Action_Menu**: The radial/stacked menu that expands from the FAB offering "Record Deposit" and "Add Bank" actions.
- **Deposit_Feed**: The scrollable list of `SavingsEntry` records displayed below the Hero_Carousel.
- **Month_Header**: A sticky section header in the Deposit_Feed grouping entries by calendar month.
- **Bottom_Sheet**: A panel that slides up from the bottom of the viewport, used for the Add Bank flow and the Edit Deposit flow.
- **Bank_Brand**: A Philippine bank or e-wallet with a recognisable logo and brand color (BDO, BPI, Metrobank, UnionBank, GoTyme, Maya, GCash, Wise, etc.).
- **Shimmer_Animation**: A brief highlight sweep across a Bank_Card after a deposit is recorded to that bank.
- **Confetti_Animation**: A short particle burst effect triggered on successful deposit save.
- **Haptic_Feedback**: A vibration pulse triggered via `navigator.vibrate()` on successful save actions.
- **Swipe_Delete**: A left-swipe gesture on a Deposit_Feed item that reveals a delete action.
- **Swipe_Edit**: A right-swipe gesture on a Deposit_Feed item that opens the edit Bottom_Sheet.

---

## Requirements

### Requirement 1: Hero Carousel — Total Savings Card

**User Story:** As a user, I want to see my total savings at a glance at the top of the Savings tab, so that I always know my overall financial position.

#### Acceptance Criteria

1. THE Savings_Tab SHALL render the Hero_Carousel as the first visible element within the tab content area.
2. THE Hero_Carousel SHALL display the Total_Card as its first (leftmost) card.
3. THE Total_Card SHALL display the sum of all bank balances formatted as Philippine Peso (₱) with two decimal places.
4. WHEN no banks have been added, THE Total_Card SHALL display a balance of ₱0.00 and a prompt to add a bank.

---

### Requirement 2: Hero Carousel — Bank Balance Cards

**User Story:** As a user, I want to swipe through individual bank cards to see each account's balance, so that I can quickly check any specific account.

#### Acceptance Criteria

1. THE Hero_Carousel SHALL render one Bank_Card per bank in `SavingsStore.banks`, ordered by insertion order.
2. WHEN a user performs a horizontal swipe gesture on the Hero_Carousel, THE Hero_Carousel SHALL advance to the adjacent card with a smooth CSS transition.
3. THE Hero_Carousel SHALL display pagination indicators (dots) below the cards reflecting the current card index.
4. EACH Bank_Card SHALL display the bank name, the computed balance (sum of all `SavingsEntry` amounts for that bank), and the bank's brand color as a glow or border accent.
5. WHERE a Bank_Brand logo is available for the bank name, THE Bank_Card SHALL display the corresponding logo image.
6. THE Hero_Carousel SHALL support touch swipe (touchstart/touchend) and mouse drag on desktop.

---

### Requirement 3: FAB and Quick-Action Menu

**User Story:** As a user, I want a single "+" button that reveals quick actions, so that the main screen stays uncluttered and I can act fast.

#### Acceptance Criteria

1. THE FAB SHALL be positioned fixed at the bottom-right of the Savings_Tab, above the bottom navigation bar, with sufficient clearance for safe-area insets.
2. WHEN the FAB is tapped, THE Quick_Action_Menu SHALL expand showing two labeled action buttons: "Record Deposit" and "Add Bank".
3. WHEN the Quick_Action_Menu is open and the user taps outside it, THE Quick_Action_Menu SHALL collapse.
4. WHEN "Record Deposit" is selected from the Quick_Action_Menu, THE Savings_Tab SHALL open a deposit entry Bottom_Sheet.
5. WHEN "Add Bank" is selected from the Quick_Action_Menu, THE Savings_Tab SHALL open the Add Bank Bottom_Sheet.
6. THE Savings_Tab SHALL NOT render any inline deposit or add-bank forms directly in the tab content area.

---

### Requirement 4: Deposit Entry Bottom Sheet

**User Story:** As a user, I want to record a deposit via a bottom sheet, so that the action feels native and doesn't disrupt my view of the feed.

#### Acceptance Criteria

1. THE Bottom_Sheet for deposit entry SHALL contain: a bank selector, an amount input (numeric), a date input (defaulting to today), and an optional note field.
2. WHEN the deposit Bottom_Sheet is opened with a bank pre-selected (e.g., tapping a Bank_Card), THE Bottom_Sheet SHALL pre-populate the bank selector with that bank.
3. WHEN the user submits a valid deposit (bank selected, amount > 0), THE Savings_Tab SHALL append a new `SavingsEntry` to `SavingsStore.entries`, call `saveSavings`, trigger Haptic_Feedback, and close the Bottom_Sheet.
4. IF the user submits the deposit form with no bank selected or amount ≤ 0, THEN THE Bottom_Sheet SHALL display an inline validation error and SHALL NOT save or close.
5. WHEN a deposit is successfully saved, THE Savings_Tab SHALL trigger the Shimmer_Animation on the corresponding Bank_Card and the Confetti_Animation.
6. THE Bottom_Sheet SHALL be dismissible by dragging it downward or tapping the backdrop.

---

### Requirement 5: Deposit Feed

**User Story:** As a user, I want to see a chronological feed of my deposits below the hero cards, so that I can review my savings history at a glance.

#### Acceptance Criteria

1. THE Deposit_Feed SHALL display all `SavingsEntry` records sorted by date descending (newest first).
2. THE Deposit_Feed SHALL group entries under Month_Headers formatted as "Month YYYY" (e.g., "July 2025").
3. WHILE the user scrolls the Deposit_Feed, THE Month_Header for the current visible group SHALL remain sticky at the top of the scroll container.
4. EACH entry in the Deposit_Feed SHALL display: the bank name (with brand color accent), the deposit amount formatted as ₱, and the date.
5. WHERE a note exists on a `SavingsEntry`, THE Deposit_Feed SHALL display the note beneath the amount.
6. WHEN the Deposit_Feed contains no entries, THE Deposit_Feed SHALL display an empty-state message prompting the user to record their first deposit.

---

### Requirement 6: Swipe-to-Delete on Deposit Feed

**User Story:** As a user, I want to swipe left on a deposit entry to delete it, so that I can remove mistakes without navigating away.

#### Acceptance Criteria

1. WHEN a user swipes left on a Deposit_Feed entry beyond a threshold of 72px, THE Deposit_Feed SHALL reveal a red "Delete" action button behind the entry.
2. WHEN the revealed "Delete" button is tapped, THE Savings_Tab SHALL remove the corresponding `SavingsEntry` from `SavingsStore.entries`, call `saveSavings`, and animate the entry out of the feed.
3. WHEN a left-swipe does not reach the 72px threshold and the user releases, THE Deposit_Feed entry SHALL snap back to its original position.
4. IF the user begins a vertical scroll gesture, THEN THE Savings_Tab SHALL cancel any in-progress horizontal swipe on that entry.

---

### Requirement 7: Swipe-to-Edit on Deposit Feed

**User Story:** As a user, I want to swipe right on a deposit entry to edit it, so that I can correct amounts or notes inline.

#### Acceptance Criteria

1. WHEN a user swipes right on a Deposit_Feed entry beyond a threshold of 72px, THE Deposit_Feed SHALL reveal a blue "Edit" action button behind the entry.
2. WHEN the revealed "Edit" button is tapped, THE Savings_Tab SHALL open the deposit entry Bottom_Sheet pre-populated with the selected entry's data.
3. WHEN the user saves an edited deposit, THE Savings_Tab SHALL update the corresponding `SavingsEntry` in place, call `saveSavings`, trigger Haptic_Feedback, and close the Bottom_Sheet.
4. WHEN a right-swipe does not reach the 72px threshold and the user releases, THE Deposit_Feed entry SHALL snap back to its original position.

---

### Requirement 8: Add Bank Bottom Sheet

**User Story:** As a user, I want to add a new bank or wallet via a bottom sheet with brand logo support, so that my bank cards look recognisable and visually distinct.

#### Acceptance Criteria

1. THE Add Bank Bottom_Sheet SHALL contain: a bank name input (or brand picker), and a color picker defaulting to the selected brand's color.
2. THE Add Bank Bottom_Sheet SHALL display a scrollable grid of Bank_Brand options for: BDO, BPI, Metrobank, UnionBank, GoTyme, Maya, GCash, Wise, and a generic "Other" option.
3. WHEN a Bank_Brand is selected from the grid, THE Add Bank Bottom_Sheet SHALL auto-populate the bank name field and set the color to the brand's canonical color.
4. WHEN the user submits a valid bank name (non-empty), THE Savings_Tab SHALL append a new `Bank` to `SavingsStore.banks`, call `saveSavings`, and close the Bottom_Sheet.
5. IF the user submits the Add Bank form with an empty name, THEN THE Bottom_Sheet SHALL display an inline validation error and SHALL NOT save or close.
6. WHEN a bank is successfully added, THE Hero_Carousel SHALL update to include the new Bank_Card without a full page reload.

---

### Requirement 9: Haptic Feedback

**User Story:** As a user, I want to feel a vibration when I save a deposit, so that I get tactile confirmation that my action succeeded.

#### Acceptance Criteria

1. WHEN a deposit is successfully saved, THE Savings_Tab SHALL call `navigator.vibrate(80)` to trigger a short haptic pulse.
2. WHERE `navigator.vibrate` is not available in the current browser, THE Savings_Tab SHALL proceed without error and omit the vibration silently.

---

### Requirement 10: Success Animations

**User Story:** As a user, I want to see a visual celebration when I save a deposit, so that the app feels rewarding to use.

#### Acceptance Criteria

1. WHEN a deposit is successfully saved, THE Savings_Tab SHALL play the Shimmer_Animation on the Bank_Card corresponding to the deposit's `bankId`.
2. THE Shimmer_Animation SHALL consist of a highlight sweep (CSS keyframe animation) lasting no longer than 800ms.
3. WHEN a deposit is successfully saved, THE Savings_Tab SHALL play the Confetti_Animation as a short CSS/canvas particle burst lasting no longer than 1200ms.
4. THE Confetti_Animation SHALL NOT block user interaction with the rest of the Savings_Tab during playback.
5. WHEN the Hero_Carousel is not currently showing the Bank_Card for the saved deposit, THE Savings_Tab SHALL animate the carousel to that card before playing the Shimmer_Animation.
