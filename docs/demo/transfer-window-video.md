# THE SUMMER WINDOW — demo video script (WhiteHartLane / whl)

A ~92-second film (60s trim map included) that shows a levy
commissioning a nested coworker spur, the spur signing a real player
by rules, a poisoned pane, and a continue-from-checkpoint rebirth —
every mechanic real, every number real (the actual August 2026
window).

Program folder: `examples/coworker-spurs/transfer-window/` (top spur
+ `negotiation-room/` child + `workflow.broken.toml` poison variant).

---

## 1. The true story (use it, it's better than fiction)

- Spurs spent a year looking for Son's replacement as a wide attacker
  (failed with Mbeumo, Semenyo). De Zerbi's rebuild, 12 out.
- **Ndiaye** (Everton): valued £75–80m, City circling → City signed
  him deadline day, £60m + £5m add-ons (BBC, 2026-09-01). Spurs were
  beaten to him.
- **Gakpo** (Liverpool): Barcola's £120m move to PSG/Liverpool made
  him available; fee ~£70m, but the wage demand was the wall.
- **Sávio** (Man City): asked to leave; **Spurs signed him
  2026-08-25: £75m initial + £10m add-ons = £85m** (BBC/Guardian/
  Athletic, 2026-08-21..25). He even renamed himself — Savinho
  became Sávio at the unveiling.

Our demo replays exactly this: coach asks for the winger, scout names
the three real targets with real numbers, the room applies the real
gates, and Sávio passes them for the real price.

## 2. Format

- 16:9, 1920×1080 (UI + terminal), macro inserts letterboxed 4K.
  A 9:16 crop note is at the end.
- Director's cut **92s**; tight cut **60s** (trim map in §6).
- Two acts: HAPPY PATH (0:00–1:03), FAILURE PROOF (1:03–1:32).

## 3. Style — Bauhaus, yes. Here is the law of it.

Bauhaus fits this system because the system IS functionalist: rules
do the management, decoration is impossible, form follows function.
So the motion layer gets full Bauhaus discipline; the PRODUCT FOOTAGE
stays authentic (the window's own "Night at the Lane" dark theme) —
the contrast reads as "engineered, not staged".

**Geometry law (one shape per role, never violated):**
- ○ circle — **levy** (the chairman's office; one chat, one wake)
- □ square — **worker pane** (coach, scout, finance, the desks)
- △ triangle — **the decider** (the professor)
- the grid itself — **the rail** (lines mail travels on; never a
  character, always a line)

**Palette (motion layer):** off-white `#F4EFE6` ground, ink `#141414`,
red `#E13429` (action/error), blue `#1F4BA6` (state, booked wait),
yellow `#F2B705` (decision, wake, the signing). Footage keeps its own
colors; lower-thirds use the ink keyline + hard 6px offset shadow.
*Lilywhite variant* (optional): red→`#132257` navy, blue→lilywhite,
yellow stays — for the Spurs-loyal cut.

**Type:** Archivo Black (display, ALL CAPS, tracked −2), Inter
(supporting, tabular numerals for counters). Two sizes only.

**Motion law:** cuts land ON the beat grid (108 BPM, ~555ms per
beat); every move is a 120–150ms hard snap; NO cross-dissolve except
two moments — abort (fade to ink 250ms) and rebirth (shutter wipe
250ms). Act transitions slide on a 20° diagonal (Bauhaus poster
angle).

**SFX vocabulary (reuse, never invent):** tick (the rail's 5s beat,
always running, quiet), typewriter clack (a relay lands), rubber
stamp (a gate FAILS/PASSES), single desk bell (a wake), low thud +
ALL silence for 1.5s (the abort), camera shutter (the rebirth), pen
scratch (the signing file write).

**On-screen text style:** lower-third = yellow or ink slab, 1px ink
keyline, hard shadow; counters in tabular numerals top-right
("MESSAGES 04 / RELAYED 04"); event names from the real trace
(`job.born`, `pane.born`, `relay`, `wake`, `job.aborted`,
`job.continued`, `job.retired`) shown as small mono chips — the
audience learns the real vocabulary.

## 4. Beat sheet — director's cut (92s)

Sync points are the REAL events from the session trace; the editor
matches footage to them.

| # | Time | SCREEN | VO (final copy) | TEXT / SFX |
|---|------|--------|-----------------|-----------|
| 01 | 0:00–0:05 | Ink black. On three beats: ○ snaps top-left, △ center, □□□ right. Grid lines draw under them. Title stamps. | "One commission. Eleven rules. Zero managers." | TITLE: **THE SUMMER WINDOW** · sub: *WhiteHartLane — a supervisor, not a mind* · music in: ticks + 108bpm pulse |
| 02 | 0:05–0:13 | Bauhaus diagram, split by the diagonal: LEFT ○ "LEVY — one chat, one wake"; RIGHT △ over □□□ in one frame "SPUR — coach · scout · finance". Mail animates ○→□ along grid lines. | "A levy commissions. A spur runs itself: every pane born booked, every message carried by a rail that never thinks." | chips: `pane.born` `relay` · SFX tick |
| 03 | 0:13–0:21 | A-roll: the levy pane (opencode in herdr). Macro on the typed mission. The levy restates it in football language, then the command. | "July, 2026. Son has gone. You don't manage the window — you commission it: one prompt, one door, and you walk away." | INSERT (macro): *"Find the right winger and sign him. £85m all-in."* → refined line: *"inverted RW · dribbling 9 · crossing 8+"* → `whl run . --from opencode:ses_…` · SFX door slam · chip `job.born` |
| 04 | 0:21–0:27 | herdr: beside the levy, a tab splits into three lanes, titles snap: coach · scout · finance. | "Three panes, three briefs, one law: they talk only through the rail." | chips ×3 `pane.born` · SFX three ticks |
| 05 | 0:27–0:33 | coach pane answers (its one note). The message file flashes; grid line carries it to scout's lane. | "The coach wants one thing: an inverted right winger who beats his man and delivers from the byline." | SFX typewriter · chip `relay` · counter MESSAGES 01 |
| 06 | 0:33–0:39 | scout pane (born idle, wakes with brief + mail together — show the `-----` split). The three-line table types itself. | "The scout reads the 2026 market. Three names, real numbers: Ndiaye the bid war, Sávio the profile, Gakpo the wage wall." | TABLE (Bauhaus slab): NDIAYE £78m · SÁVIO £75m+10 · GAKPO £70m/£190k · src chip *BBC · Athletic · Aug 2026* · chip `relay` |
| 07 | 0:39–0:47 | finance pane: "Three desks. One professor." — the levy command runs; a NEW tab: □□□ share the room, △ alone in his office; orchestrator lane logs the wait. | "Finance doesn't negotiate — it levies. A room of three desks and a professor. Finance books a wait, not a babysitter." | chip `job.born` (child) · orchestrator log line INSERT: *"booked wait finance: a live child spur holds it"* (blue) |
| 08 | 0:47–0:55 | The room, montage on the beat grid: mandate △→□□□ (3 clacks); offers □→△ (3 clacks); gates stamp one by one. | "Three offers in. The gates don't mood: Ndiaye fails the fee. Gakpo fails the wages. Sávio — passes everything." | STAMPS: NDIAYE ✗ £78m>£75m · GAKPO ✗ £190k>£160k · SÁVIO ✓ £75m+10 · chips `relay` ×6 |
| 09 | 0:55–1:03 | Macro: `signing/savio.md` being written. The wake travels △→finance's pane (`[wake] spur … done`), finance relays, `stop`. The LEVY pane gets its one wake. UI: success chip, receipt "panes remaining 0". | "The professor signs. One wake rolls uphill — finance, then the chairman — exactly once. The window closed itself." | SFX pen scratch → desk bell ×2 · chips `wake` `job.retired` · CARD: **CASE: SUCCESS** (yellow) · 1.5s hold |
| 10 | 1:03–1:11 | Act II. Rewind stutter (3 inverted ticks). The broken toml on screen; the Sávio desk's pane fills with the real API error; nudges appear; then the deliberate kill — UI: the run → ABORT → the confirm modal, verbatim. | "Now poison one desk. The rail retries, nudges, refuses to guess. When a pane is dead weight, you abort — kills now, keeps every booked pointer." | INSERT (macro, red): *`Error: An active OpenCode Go subscription is required to use Go models.`* · modal text verbatim: *"Abort run j-…? Kills now — booked sessions survive; a Continue can bring it back."* · SFX thud → silence 1.5s · UI chip: aborted (claret) · jobs line: *"— continue?"* |
| 11 | 1:11–1:17 | Terminal: open the RUN-DIR `workflow.toml` (path from the UI). One line changes, save. | "Fix what the run actually reads — the staged manifest in the run dir. One line: the gate comes off the Sávio desk." | INSERT (macro): `[members.negotiator-savio] model = "opencode-go/glm-5.3"` → `"zhipuai-coding-plan/glm-5.3-flash"` · SFX keystroke ×1, tick returns |
| 12 | 1:17–1:27 | UI: CONTINUE → confirm. herdr: panes respawn one by one (stagger); the professor's pane already holds two offers (macro on his transcript); only the Sávio desk works; then △ wakes, stamps, signs again. UI: `job.continued` (accent) → success. | "Continue. Every pane resumes its own session. Delivered mail is never re-sent. Only the broken desk works — the checkpoint kept the rest." | chips `job.continued` `pane.born` ×4 · INSERT: professor's pane showing 2/3 offers already in · SFX shutter → 2 clacks → stamp ✓ → bell |
| 13 | 1:27–1:32 | Bauhaus outro: the shapes retire into the grid; the tick stops on the last beat. | "Levy a spur. Never babysit it." | CARD: **WHITEHARTLANE** · sub: *agents at the edges, determinism in the middle* · final chip `job.retired` receipt: panes remaining 0 |

## 5. Footage shot list (what to record)

Sync = wait for this event, then roll.

| Shot | Roll on | Content |
|---|---|---|
| F1 levy-mission | — | levy pane: typing the mission (type it for real or paste-in macro later) |
| F2 levy-command | levy's turn | the `whl run . --from opencode:$(opencode session list -n 1 \| head -1 \| cut -f1)` line + door output (`job:` `log:` `trace:`) |
| F3 top-tab | first `pane.born` | herdr tab split ×3, lane titles coach/scout/finance |
| F4 coach-turn | `relay` coach→scout | coach's answer + message file |
| F5 scout-turn | `relay` scout→finance | scout waking (brief+mail split), the table reply |
| F6 finance-levy | child `job.born` | finance's command, child tab opening, professor's own tab |
| F7 booked-wait | orchestrator log line | the log line + finance idle |
| F8 room-run | `relay` ×6 | mandates, offers (cut on the beats) |
| F9 gates+signing | last `relay` → `wake` | professor's decision turn; macro `signing/savio.md` |
| F10 wake-chain | `job.woke` ×2 | `[wake]` in finance's pane; finance's stop; `[wake]` in the levy pane |
| F11 UI-happy | — | window: Spur Runs row going green; Spur Status events tab streaming; receipt tab |
| F12 poison | error text visible | broken toml `cp`; run; Sávio pane errors; nudges/chase in orchestrator lane |
| F13 abort | your click | UI row → Abort → modal → confirm; aborted chip; `whl jobs` line `— continue?` |
| F14 fix+continue | your click | run-dir toml edit (macro); UI Continue → confirm; respawn stagger; professor transcript macro; success |

## 6. 60-second trim map

Drop: beat 02 to 4s (diagram only), merge 05+06 (coach+scout 9s
total), compress 08 to three stamps (5s), merge 09 into 08's tail
(6s), 10 to 6s (error + modal only), 11 to 3s (the one-line diff),
12 to 8s, 13 to 3s. Keep 01 (4s), 03 (7s), 04 (5s), 07 (7s).

## 7. Honesty appendix (what is real; where the script bends)

1. **"Auto abort" is the one bend.** A pane that errors forever does
   NOT auto-abort the job — it dies through the nudge ladder and the
   run retires FAILED, which `whl continue` refuses
   (`continue: j-… is retired, not paused/aborted/orphaned`). The
   honest mechanic — and the better story — is the deliberate abort:
   the modal's own words say it ("booked sessions survive; a Continue
   can bring it back"). Parked ≠ broken is the product's philosophy.
2. **The fix lands in the run dir.** `whl continue` re-reads the
   staged `<session>/jobs/<jid>/run/workflow.toml`; the source folder
   is identity (content hash), not runtime config. The macro in beat
   11 shows the run-dir path on purpose.
3. **The room is a coworker, not a lab.** The professor+students
   shape is the lab rail's native form, but a single poisoned desk
   needs per-member models — coworker-only. Side effect: the lane law
   (max 3/tab) puts the professor in his own tab. The students share
   the room; the decider sits in his office.
4. **The API error is real.** `opencode-go/glm-5.3` behind the
   OpenCode Go gate returns the verbatim error shown in beat 10. No
   mock, no dead key.
5. **Panes are real agents** (glm-5.3-flash), not scripted — takes
   may need more than one attempt; the trace (`whl events`) is the
   replay log. The first smoke run of the room actually hit a refused
   mail (the professor misnamed his files; the rail refused, nudged,
   and the refusal healed) — keep that as a bonus beat if you have
   6 spare seconds: *"the rail refuses bad mail and coaches it back
   to health."*
6. **Numbers are real** (BBC 2026-08-21/09-01, Guardian 2026-08-25,
   Athletic 2026-08-24..28, Transfermarkt). Ability scores are the
   scout's (ours).

## 8. Capturing on this machine

- **UI (real, pixel-true):** Playwright chromium `recordVideo` over
  `http://127.0.0.1:8787` — the Abort/Continue clicks in beats 13–14
  are the real buttons POSTing the real verbs.
- **Panes (text-true):** `herdr agent read <name>` snapshots on a 2s
  loop → render as a clean terminal replay (asciinema-style) in the
  edit; or grant Screen Recording to the terminal app and capture
  herdr live for A-roll.
- **Events:** `whl events <sid>` is the ground truth; paste kinds
  into the edit's chip layer.

### 9:16 vertical variant

Center column = the active pane only; the Bauhaus diagram stacks
(○ over △ over □□□); gates stamp full-width; keep beats 03, 08, 10,
12 as pillars.
