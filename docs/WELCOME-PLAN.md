# Plan — Landing hero (Zapline-style) adapted into the Dash app at `#/welcome`

## Context
The user pasted a "Zapline / Royal Violet" hero prompt (starfield + glowing planet rim, big centred headline, two CTAs, a dark dashboard preview rising from the bottom edge) and asked to adapt it to **our** UI. Decisions already made by the user (AskUserQuestion):
- Placement: a landing page **inside the same app at `#/welcome`** (not a separate file).
- Colour: keep the concept but render it in **navy / sky-blue** (our palette; the earlier "no purple" rule stands).
- Media: **draw everything with canvas/CSS** — no external video/PNG (the cloudfront assets belong to someone else, may vanish, and are violet).
- Brand/copy: brand **"Dash"**, Thai headline/lede written by me (user's answer was just "dashboard"; I read it as "brand = Dash/dashboard" — flagged below so they can correct it when reviewing).

Existing app being extended: vanilla HTML/CSS/JS, no build, hash router (`js/router.js` `ROUTES`, `<section data-page>` toggling), tokens in `css/tokens.css` (navy/sky v2, dark default + ฟ้า-ขาว light), modules talk through `window.FM` (`FM.get/set/on/emit`, `FM.fmtMoney`, `FM.cats`, `FM.kpi._calc`, `FM.ui.openSlip`). Rules in `CLAUDE.md` still apply (no emoji, no `#000`, tokens only, transform/opacity animation, reduced-motion, WCAG AA, 320–1440 w/o horizontal scroll).

## Approach
### 1. Routing & shell (small targeted edits)
- `js/router.js`: add `welcome` to `ROUTES` (`#/welcome`, title "Dash · การเงินและกิจวัตร"); set `document.body.dataset.route = <name>` on every route change (if not already done); first-visit logic — if there is **no hash** and `FM.get('welcomed') !== true`, go to `welcome`; a deep link (`#/tx`, …) is never redirected. CTA sets `FM.set('welcomed', true)`.
- `css/shell.css`: `body[data-route="welcome"]` hides `.rail`, `.topbar`, `#theme-toggle` and the bottom tab bar and lets `.pages` be full-bleed (no rail padding / bottom-bar padding). Dialogs (`#slip-drawer`, `#adjust-dialog`, cloud dialog) stay available.
- `index.html`: new `<section class="page page--welcome" data-page="welcome">` (+ `<link css/welcome.css>`, `<script js/welcome.js>` before `main.js`), `js/main.js` calls `FM.welcome.init()`.

### 2. New files
- `css/welcome.css`, `js/welcome.js` (module `FM.welcome`), a few `--hero-*` tokens appended to `css/tokens.css` (additive).

### 3. Hero design (adapted from the prompt)
- **Stage/scaling:** 1672×941 design stage, `s = min(vw/1672, vh/941)` written to a CSS var on resize (rAF-throttled), centred; sky/stars fill the whole viewport; dashboard panel stretches to the bottom edge. `<900px` or portrait → stacked mobile layout.
- **Always dark:** the welcome page re-declares the dark token set locally (`.page--welcome { color-scheme: dark; … }`) so it looks right even when the app is in light mode; background uses `--bg` dark (`#060B16`) instead of pure `#000` (project rule).
- **Sky (canvas, aria-hidden):** `<canvas>` layer 1 = procedural white-dot starfield (seeded, ~220 stars, DPR capped at 2, redrawn only on resize). Layer 2 = planet rim: large circle centred above the top edge, rim painted from a small polar colour table (core `--sky` → `--blue` → transparent) + outer bloom via radial gradients, with `mix-blend-mode: screen`. Violet `#9312ff/#a020ff/#7a1cf8` → `--blue`/`--sky`.
- **Life without the video:** since the video is dropped, add a restrained CSS-only pulse on the rim bloom (opacity, ~4s ease) and 2–3 light streaks (translate+opacity) — documented deviation from the prompt's "nothing animated in code"; all off under `prefers-reduced-motion`. No rAF loop while idle.
- **Nav:** small logo mark (inline SVG, our own bolt-like glyph, stroke 1.5) + "Dash"; centred pill menu **หน้าแรก · ภาพรวม · รายการ · กิจวัตร** (real routes, Home = dark pill active); right pill **"เริ่มใช้งาน"** (→ `#/`, sets `fm.welcomed`). Mobile: collapses to a menu button opening a `<dialog>`/popover with the same links.
- **Headline (h1, ~84px stage px, Outfit 700 + Noto Sans Thai 700):** "**Dash** ดูเงินและกิจวัตร / ครบในหน้าเดียว" — brand word with a blue→sky gradient (the prompt asks for it; overrides the generic "no gradient text" guideline only here). **Lede:** "บันทึกรายรับรายจ่ายจากสลิปธนาคารในไม่กี่วินาที ดูกราฟและงานประจำวันรวมกัน ข้อมูลอยู่ในเครื่องคุณและซิงก์ขึ้นคลาวด์เมื่อเข้าสู่ระบบ". **Buttons:** primary "เริ่มใช้งาน", secondary dark "ลองอ่านสลิป" (→ `FM.ui.openSlip`).
- **Dashboard preview panel** (1204px stage px wide from y=651, radius 14, dark glass + 1px blue border, glowing top edge drawn with a blurred gradient line + a CSS strip instead of the PNG): sidebar (Dash, Dashboard active pill, รายการ, กิจวัตร, ตั้งค่า…, promo card "ซิงก์ข้ามเครื่อง" with a pill), top bar (chip showing signed-in email via existing cloud state or "ผู้เยี่ยมชม"), two stat cards (รายรับเดือนนี้ / รายจ่ายเดือนนี้ with ▲▼%), "กราฟรายวัน" area chart (hand-drawn inline SVG, sky stroke over faint blue fill), right column "สรุปเดือนนี้" rows (จำนวนรายการ, งานที่ทำเสร็จ, สลิปที่อ่าน). Data comes from real storage via reuse of **`FM.kpi._calc`** (month totals + %), `FM.get('tx')`, `FM.get('tasks')`, `FM.fmtMoney`; if there is no data, show clearly-labelled **sample data** ("ข้อมูลตัวอย่าง") so the hero never looks empty. Panel is decorative → `aria-hidden="true"` + `inert`.
- **Entrance timeline (one):** nav fades down → headline wipes up line by line → lede/buttons → dashboard rises → its parts settle in a stagger; `transform/opacity` only, `--ease`. Hover: buttons brighten with a blue glow (hover only, not default state). Reduced motion: no entrance, no pulse/streaks.
- **Fonts:** keep project fonts (Outfit + Noto Sans Thai + Geist Mono for numbers) instead of the prompt's Inter, because Thai glyph coverage and the project's design rules.

### 4. Execution (after approval, savvy-flow)
- **W1 — Careful worker:** `js/welcome.js`, `css/welcome.css`, token additions, `index.html`/`router.js`/`shell.css`/`main.js` edits (targeted), `docs/SPEC.md`/`filemap.md` notes. Brief includes this plan verbatim + file/API pointers above.
- **Orchestrator review:** read the diff, view at 1440×960 and the other sizes myself (screenshots), check the Acceptance list; run the `improve-animations` audit read-only on the new motion.
- **W2 — Medium QA:** a11y/contrast, responsive, reduced-motion, regression of all existing routes/features, console/network cleanliness.
- Then commit; push to GitHub only when the user asks; add an Obsidian Route note (new file in `UIUX design`).

## Critical files
`js/router.js` (ROUTES, init redirect, `body[data-route]`), `css/shell.css` (hide shell on welcome), `index.html` (new section + link/script), `js/main.js`, `css/tokens.css` (+`--hero-*`), new `js/welcome.js`, `css/welcome.css`. Reused: `FM.kpi._calc` (`js/kpi.js`), `FM.fmtMoney`/`FM.get`/`FM.set` (`js/store.js`), `FM.ui.openSlip` (`js/router.js`), `FM.cats` (`js/categories.js`).

## Verification
1. Serve (`python -m http.server 8777`) and open `/` with empty storage → lands on `#/welcome`; press "เริ่มใช้งาน" → `#/`, reload → stays on `#/` (welcomed); deep links `#/tx`, `#/tasks` unaffected; back/forward work.
2. **Acceptance @1440×960** (from the prompt, translated): blue rim glows across the top and pulses; headline + buttons centred; blue-edged dashboard fills the lower half; no real brands. Also check 1672×941, 1280×720, exactly 900px, 375×812 portrait (stacked layout, headline ≤3 lines, nav menu button, preview scrolls).
3. Light vs dark app theme: welcome always renders dark; other pages unchanged.
4. Reduced motion (emulated, state how): no entrance, no pulse/streaks, static canvas.
5. Contrast of headline/lede/buttons/preview text vs hero background (≥4.5:1 text, ≥3:1 UI); keyboard tour (nav, CTAs, mobile menu dialog, focus return); one h1; preview hidden from AT.
6. Network: no request to cloudfront/any new external host; console clean; resize performance OK (canvas redraw only on resize).
7. Regression: overview/tx/tasks pages, slip drawer opened from the hero, cloud sign-in dialog still works.

## Open points to confirm with the user at review
- Brand "Dash" and the Thai copy above (proposed by me).
- First-visit auto-redirect to the hero (recommended) vs showing it only via the menu.
- Accept the two small deviations from the prompt: pulse/streak CSS animation (no video) and project fonts instead of Inter.
