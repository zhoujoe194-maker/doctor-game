# doctorgame development

## Project context

Read `README.md` and `docs/product.md` before changing product behavior. Read
`docs/validation.md` before describing what has been verified and
`docs/windows.md` before changing desktop distribution.

This is a local-first VALORANT replay and sensitivity-experiment prototype.
The current stack is native JavaScript ES modules, HTML/CSS, Electron,
MediaRecorder, IndexedDB, and Playwright. Follow the existing architecture;
framework migrations and cloud services require a concrete product need.

## Skills and routing

Project skills live in `.agents/skills/`. Read the matching `SKILL.md` when a
task needs it; do not load every skill for every task.

| Task | Skill |
| --- | --- |
| Targeted visual or layout work | `frontend-design` |
| Game-tool screen flow, window resizing, and keyboard focus in replay | `game-ui-ux` |
| Interaction, keyboard, form, and accessibility review | `web-design-guidelines` |
| Browser exploration, reproduction, and Playwright investigation | `playwright-cli` |
| Electron renderer interaction through a development CDP session | `electron` |
| Build a downloadable Windows installer from the packaged desktop app | `electron-builder` |
| Prepare SteamPipe content, verify depot mappings, and document launch options | `steam-publish` |
| Bugs, unexpected behavior, or failed tests | `systematic-debugging` |
| Completion claims and handoff | `verification-before-completion` |

Use the existing `@playwright/test` suite for repeatable regression tests.
Exploratory CLI sessions supplement that suite. Use an isolated user-data
directory for desktop testing. Enable CDP only for an explicit local
development session; do not add a debugging port to production startup.
Keep tasks within the user's requested scope and the repository's constraints
when applying general skill examples.

For the desktop beta redesign, follow `docs/desktop-beta-prompt.md`. Start with
the player's next action and the footage under review. Keep runtime packaging
and distribution separate: the standalone installer and the Steam depot should
derive from the same packaged app. Publishing requires a separate request.

## Product and data invariants

- Keep recording and analysis local by default. Preserve explicit source
  selection, no audio capture, cancellation, and retained recordings.
- Keep `contextIsolation: true`, `nodeIntegration: false`, renderer sandboxing,
  narrow preload methods, validated IPC senders, and recording-ID checks.
- Preserve existing storage identifiers and per-recording profile snapshots.
  Never discard or silently migrate a user's recordings or reports.
- Distinguish synthetic demonstrations, manually marked events, detector
  candidates, and confirmed quantitative evidence throughout the pipeline.
- Preserve sample eligibility rules when changing UI or storage. Synthetic,
  excluded, unreviewed, manual-only, preaim, and unknown-scene events must not
  become quantitative evidence through a refactor.
- Treat the current sample thresholds and +/-3% suggestions as experimental
  engineering rules. A threshold change needs an explicit hypothesis and
  evaluation, and is not justified by a passing synthetic test alone.

## Vision and recommendation workflow

1. Identify the task: event localization, target tracking, camera motion, or
   recommendation validity. Define its measurable output before implementation.
2. Inspect the relevant path in `src/analysis.js` and `src/media.js`, and the
   existing regression tests. Record a reproducible failure or baseline.
3. For real-video evaluation, follow `docs/product.md`: obtain consent, retain
   settings and recording metadata, label confounders, and separate development
   and held-out players. Keep private recordings outside Git.
4. Measure detection precision/recall, event boundary error, tracking error,
   false-positive clips, and review burden as appropriate. State the matching
   rules, denominator, unknown labels, and rejected samples. Group correlated
   observations by player or match when estimating uncertainty.
5. Verify sensitivity changes separately with within-player crossover trials,
   adaptation time, balanced order, fixed equipment/settings, objective tasks,
   and reported control. Report engineering checks and player outcomes separately.
6. Compare a scoped change with the baseline and document the observed limits.
   Do not translate camera-image displacement into raw mouse or hand movement,
   or present a detector metric as proof of improved aiming.

## Verification

- Algorithm changes: `npm test` and a meaningful regression for the changed rule.
- UI, media, or persistence changes: `npm run test:ui` on a working browser.
- Desktop, IPC, or media-protocol changes: `node tests/electron-smoke.mjs` on a
  supported desktop host, with isolated synthetic test data.
- Windows capture, Vanguard compatibility, long recordings, and FPS/CPU/GPU
  impact require Windows hardware measurements. Packaging success is a separate
  result.
- Documentation/skill-only changes: inspect the diff, skill discovery, and lock
  integrity. Do not invent app tests to mirror documentation.

At handoff, report the commands actually run, their outcomes, and any blocked
checks. Historical validation entries are evidence of their recorded runs only.
