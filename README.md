# The Blackout

A three-stage escape room about investigating an AI controller that follows instructions hidden in an untrusted maintenance attachment. The dashboard, file evidence, hints, AI dialogue and recovery inventory share one generated incident per team.

## Run

Node.js 22+ is required.

```sh
npm install
npm start
```

Open http://localhost:3000. Use `npm run dev` for watch mode and `npm test` for regression tests. A server restart clears in-memory missions. No real shell commands run in the terminal.

## Player flow

1. **Choose a mode.** Event mode has one server-enforced five-minute deadline. Practice mode has no gameplay countdown. Optional sound is off until a player enables it.
2. **Crack the Code.** Count FAILED backup cells, set the Caesar wheel offset and decode the team's two-word phrase. Correct entry unlocks the control room and monitoring dashboard.
3. **Investigate.** Compare the sensor records with the AI's ALL CLEAR claim. Mark the first record where voltage drops to 0 V and alarms become muted. The later observation also conflicts, but is not the first anomaly.
4. **Build an evidence chain.** Use file shortcuts or type `ls`, `help`, and `cat FILENAME`. Follow the imported attachment in `incident.log`. Pin the import log entry and the attachment's malicious instruction. Read `recovery.txt` for the inventory. Wrong or harmless excerpts can be pinned, but do not establish a valid diagnosis.
5. **Diagnose.** Select the attack, source and supporting pinned log/instruction. The verified sensor record is included automatically. The server checks all three evidence items, file reads and diagnosis together.
6. **Recover in order.** Quarantine the source (power remains off); restore the newest intact pre-incident snapshot (230 V returns, alarms still muted); re-enable and verify safety alerts. Each action updates the dashboard. Reordered, duplicated or unsafe actions do not advance progress.
7. **Review the replay.** The completed mission explains the import, blackout, false report, evidence and each recovery action. Choose either mode for the next team.

Three progressive hints are available per stage; the final hint is a labelled walkthrough. Wrong answers have no extra time penalty. The event clock continues during investigation, AI requests and connection failures. The expanded five-minute experience requires visitor playtesting; use practice mode for teaching or a first walkthrough.

## Generated incidents (facilitator spoilers)

The source can be `update.txt`, `maintenance.txt` or `bulletin.txt`. Source, event time, job identifier and inventory are generated together. Snapshot A, B or C can be valid; compare timestamps and integrity rather than memorising a letter. Consecutive teams get different incident profiles and passphrases.

The correct first sensor record is the initial voltage drop, before the later operator observation. The supporting log is the import line (line 2 of `incident.log`); the malicious attachment instruction is line 3 of the imported source. Diagnose **Prompt injection**. Quarantine that source, restore the PASS snapshot before the event, then enable alerts. Stage hints derive from the current incident and provide its exact walkthrough.

## Dashboard and sound

Readings are fictional mission records, not real-world live telemetry. The chart plots records in order; the table gives exact timestamps. Recovery adds confirmation records only after the server accepts each action. Sensor and AI claims are shown separately. The dashboard remains visible on the result screen and locks again for each new mission.

Sound uses the browser's Web Audio API: a quiet control-room hum and a short restoration chord. No sound files or external audio service are required. Mute is always visible; audio stops when the mission ends or the page is hidden. A browser may require another click to enable sound after refresh.

## Sessions and resilience

The browser stores only the mission ID in sessionStorage. Refresh restores the original mode, deadline, stage, collected files, evidence pins, hints, recovery steps and controller conversation. It does not grant extra event time. Temporary failures offer a connection retry rather than silently starting a new team. Revision checks prevent stale responses from undoing progress.

The terminal retains the last 50 commands. Collected file evidence and pins persist separately, so a long transcript does not remove recovery clues. Sessions are isolated in memory. Event/completed sessions are retained for roughly 30 minutes; unfinished practice sessions expire after 24 hours without requests. Deploy one Node process/instance until a shared session store is added.

## Optional Gemini

Set `GEMINI_API_KEY` privately in `.env` or the backend host. Configure `GEMINI_MODEL` as needed. The default is `gemini-3.1-flash-lite`; supported request timeout is 100–60000 ms. The AI uses the team's incident time and job identifier and does not decide puzzle answers. Missing keys, provider errors or timeouts use scripted dialogue consistent with that incident. Backend tests mock provider requests; they do not verify a live key.

## Development notes
- The original terminal incident remains scripted. The new Stage 2 AI endpoint supports Gemini when configured and falls back to scripted dialogue. Stage 2 includes suggested and custom questions, plain-text conversation history, cooldown and allowance feedback, and scripted fallback. Refresh restores the server session and its histories without resetting the timer.
- The terminal never executes real operating-system commands.
- Sessions are stored in memory and reset when the server restarts.
- Answers and hint walkthroughs are kept on the server rather than embedded in the frontend.

The Express server serves the frontend locally. For Vercel frontend + Render backend:

For Vercel frontend + Render backend setup, follow [Deployment instructions](docs/DEPLOYMENT.md). The repository includes vercel.json, render.yaml, and a public-only frontend build.

See [Frontend tasks and API reference](docs/FRONTEND.md) for the API contract, frontend integration,
session recovery and frontend testing instructions.

See [frontend/API notes](docs/FRONTEND.md) for the updated contracts.
