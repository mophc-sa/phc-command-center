# Group 6 (manager feedback 2026-10-19): autosave, short links, section navigation

Mo: "do what you recommend". PR 356 already covers the Back button and full intake notes.

## 1. Autosave in forms

What exists: `src/lib/form-draft.ts` + `ActionDialog`'s `draftId` prop (per user, 7-day TTL,
announced "restored · start fresh", cleared on successful submit). Only two forms opt in.

Change: every `ActionDialog` keeps a draft **by default**.

- Key: `phc-draft:<user>:<form id>`. With no `draftId`, the form id is derived from the page path
  + the dialog title + its field keys + an optional `recordId` prop (`autoDraftId`, pure, tested).
  The path already carries the record on detail pages; per-row dialogs on list pages pass `recordId`
  so one row's half-typed reason never appears on another row.
- `draftId={false}` opts out. Used for forms with secrets (never written to localStorage) and for
  forms whose content is not the person's own typing.
- A draft is restored only on top of the defaults, announced, discardable. Nothing is ever
  submitted automatically; a create/send form still needs its button.
- Language: the title is part of the derived key, so a draft started in Arabic is offered again in
  Arabic. Accepted: language switching mid-form is rare and the draft is not lost.
- Non-ActionDialog free-text forms (compose modals, notes boxes) use the same helper through a
  small hook where they have no draft today.
- Edit-in-place fields that already save to the server: debounced save (800 ms) only where a save
  action already exists and the field is a plain value edit; never for creates or sends.

## 2. Short links `/p/<code>`

- Code = the deal's RFQ number (`rfqs.rfq_number`, unique, `<REP>-<YY>-<NNNN>` e.g. FA-26-0001).
- Route `src/routes/_authenticated/p.$code.tsx` (auth gate and `next=` return already handled by
  `_authenticated`). Normalise the code (trim, decode, upper-case, allowed characters only), look up
  the RFQ, then read the opportunity **as the signed-in user**. Either read empty → one not-found
  screen, so a reader without access learns nothing (not even that the code exists). Found →
  `navigate({ replace: true })` to `/opportunities/$id`.
- No migration: both reads are ordinary RLS reads.
- "Copy link" on the deal header beside the code copies `<origin>/p/<code>`; deals with no code copy
  the full URL.
- System-generated links: the calendar feed (the one place a full UUID URL leaves the app, as the
  Outlook event URL) maps opportunity paths to `/p/<code>` when the deal has one. Needs a
  `calendar-feed` function deploy (approval-gated). In-app notification clicks are internal
  navigation, not visible URLs, so they stay as they are.

## 3. Section navigation

- Sections = outermost `<section>` elements inside `#main-content` (Panel already renders one with
  an `h3` title; command center uses `<section>`). No page edits; mounted once in `AppShell`.
- Keys: **⌥↑ / ⌥↓** (Alt+Arrow on Windows) jump to the previous/next section. Plain arrows keep
  native scrolling (hijacking them would break reading and keyboard scrolling). Ignored while typing
  (input, textarea, select, contenteditable), inside dialogs/menus/listboxes, or when a modifier
  other than Alt is held.
- A small index pill (md+ screens, only when the page has 4+ sections) shows "n / total · title"
  with previous/next buttons and a list to jump to any section.
- Scrolling uses `behavior: "auto"` under `prefers-reduced-motion: reduce`, else smooth; the target
  section gets focus (`tabindex=-1`, no outline flash) for screen readers.
- Pure logic (`src/lib/section-nav.ts`): which key means what, typing-target check, active index
  from positions, next/previous target. Tested with bun.

## Testing / docs

bun tests for `autoDraftId`, `section-nav`, `short-link`, and the calendar feed mapping (Deno test).
USER_GUIDE + CHANGELOG + AI_HANDOFF in the same PR. `bun run verify`.
