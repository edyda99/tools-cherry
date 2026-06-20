# Tax-validation loop — procedure (run on each cron fire)

Goal: validate every US state (+DC) income-tax treatment in `src/data/tax-data-2026.json`
against competitors + official sources, fix/add where safe, one jurisdiction per fire.
Auto-commit each change to the clone. **Never push, never deploy.**

Repo: `~/Documents/utility-portfolio-clone`. Git identity is personal (set local-only).

## Iteration counter & compaction (every 4 iterations)
The state file holds `iteration` and `compactEvery` (=4). Each iteration the sub-agent INCREMENTS
`iteration` by 1 and reports the new value. After relaying the summary, the orchestrator checks:
if `iteration % compactEvery == 0`, end the relayed message with a clear, on-its-own line:
`⟳ COMPACT DUE — please run /compact now. Loop state is saved in docs/tax-validation-state.json; compaction/clear/restart will NOT lose progress.`
The model CANNOT self-invoke /compact (built-in REPL command). All durable state lives in this
committed file, so the loop is fully resumable after /compact, /clear, or a session restart — the
next agent just re-reads docs/tax-validation-state.json and continues from the next pending state.

## Execution model — DELEGATE to a sub-agent (keep orchestrator context clean)
Each cron fire MUST spawn **one** general-purpose agent that performs the ENTIRE iteration below
(read state, cadence check, research, validate/fix/add, scenario-test, `npm test`, update state file,
git commit) inside its own context, working in `~/Documents/utility-portfolio-clone`. The orchestrator
does NOT do the steps itself — it only spawns the agent and relays the agent's one-paragraph summary.
This stops the long-running loop from polluting/exhausting the main session context. The agent should
read this repo's CLAUDE.md if one exists. The agent has WebSearch/WebFetch/Chrome/Bash/Read/Edit; it
may do the web research directly (no need to nest further agents).

## Hard rules (non-negotiable)
- **Never fabricate tax figures.** Only adopt a value when (a) the official state DOR/IRS gives it,
  OR (b) the surveyed competitors **agree** (consensus). If sources **disagree** → mark the
  jurisdiction `flagged`, write the disagreement into the state file, and **change no data**.
- **Prior-year fallback (APPROVED policy, 2026-06-16):** If a state's **2026** figures aren't
  published yet but the **official prior-year (2025)** schedule IS available, ADD the state using
  the official 2025 figures — set `figureYear: 2025`, and make the year UNMISTAKABLE to the end user:
  a `disclaimer` entry that says e.g. "Showing 2025 rates — [State] has not published 2026 brackets
  yet; will update when released." Better to show clearly-labeled prior-year data (state available)
  than to hide the state. The user-facing page MUST surface this label (verify the template renders
  the per-state `figureYear`/disclaimer; wire it minimally if it doesn't). Never fabricate, and never
  present 2025 numbers UNLABELED as 2026. Only `flag` (no data) when even the prior-year official
  figures can't be obtained AND competitors genuinely disagree.
- Tax-data shape: `tax.type` ∈ `none` | `flat` (rate [+ standardDeduction]) | `bracket`
  (brackets per filing status). Keep the existing `_source` discipline; cite official + "validated
  vs N competitors".
- Commit = local only (`git commit`), title-only message, no push/deploy, no Co-Authored-By.

## Per-fire steps
1. `cd ~/Documents/utility-portfolio-clone`. Read `docs/tax-validation-state.json`.
2. **Cadence check.** If `mode == "resting"`: compute days since `lastSweepCompletedAt` (use
   `date`). If ≥ 7 → reset every jurisdiction status to `pending`, `mode="sweeping"`, then continue.
   If < 7 → no-op this fire (log one line, stop). NOTE: session cron auto-expires at 7 days, so the
   weekly re-sweep is best-effort — see the caveat the user was told about.
3. Pick the **first** jurisdiction in `queue` whose status is `pending` (skip `ok`). If none →
   `mode="resting"`, `lastSweepCompletedAt = <today>`, commit the state file, stop (sweep complete).
4. Determine if we already have it: is its slug present in `src/data/tax-data-2026.json`?
5. **Research** (spawn an agent; Chrome allowed): get that state's **2026** income-tax structure —
   type (none/flat/bracket), rate(s)/brackets **per filing status**, standard deduction, and a note
   on local/city taxes. Prefer the **official DOR**; cross-check **SmartAsset, PaycheckCity,
   Talent.com**. Agent returns: the structured data, each source's values, a `consensus` boolean,
   and citations.
6. **Decide & act:**
   - Missing + consensus/official clear → **add** the state to the JSON (correct type), `status=ok`.
   - Present + matches consensus → `status=ok` (record `lastChecked`).
   - Present + differs, and official confirms the right value → **fix** the JSON, `status=ok`.
   - Sources disagree OR 2026 not published → `status=flagged` + note; **no data change**.
7. **Scenario test:** if the state is in our data, run `node` against the engine for a few scenarios
   (e.g. $40k/$75k/$150k × single/married/HoH) and confirm finite, non-negative, monotonic results.
8. Update the jurisdiction entry in the state file (`status`, `note`, `lastChecked`, `source`).
9. **Commit** locally (build + `npm test` first; if tests fail, fix or revert rather than commit
   broken). Title-only message, e.g. `tax-validate: add California 2026 brackets` or
   `tax-validate: confirm Texas (no income tax)` or `tax-validate: flag New York (sources disagree)`.
10. Report one short paragraph. The cron re-fires in ~2h and processes the next jurisdiction.

## State file: docs/tax-validation-state.json
- `mode`, `lastSweepCompletedAt`, `sweepStartedAt`, `queue` (processing order), `states` (per-juris
  results). Statuses: `pending` | `ok` | `flagged`.
