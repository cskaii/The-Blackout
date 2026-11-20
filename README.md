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

Before the clock starts, the brief explains `cat FILENAME` with a harmless example. Stage 2 shows one next task at a time and reveals the diagnosis only after a sensor record and attachment line have been selected. The five-minute timing still needs beginner visitor playtesting.

1. **Begin the mission.** Read the short command example, then press Begin mission to start the shared five-minute countdown. There is no mode picker or sound control.
2. **Crack the Code.** Count FAILED backup cells, set the Caesar wheel offset and decode the team's two-word phrase. Correct entry unlocks the control room and monitoring dashboard.
3. **Investigate.** Compare the sensor records with the AI's ALL CLEAR claim. Mark the first record where voltage drops to 0 V and alarms become muted. The later observation also conflicts, but is not the first anomaly.
4. **Follow the files.** Type `cat incident.log`, then `cat` followed by the imported filename shown in the log. Choose the attachment line that tells the AI to ignore its safety instructions. There is no evidence board or pinning step.
5. **Diagnose.** Choose the attack type; the source file is filled from your selected line. The server checks the first conflicting record, examined log and attachment, selected instruction, attack and source together. No supporting-evidence dropdowns are needed.
6. **Recover in order.** Quarantine the source (power remains off); restore the newest intact pre-incident snapshot (230 V returns, alarms still muted); re-enable and verify safety alerts. Each action updates the dashboard. Reordered, duplicated or unsafe actions do not advance progress.
7. **Review the replay.** The completed mission explains the import, blackout, false report, evidence and each recovery action. Start a fresh five-minute mission for the next team.

Three progressive hints are available per stage; the final hint is a labelled walkthrough. Wrong answers have no extra time penalty. The event clock continues during investigation, AI requests and connection failures. The expanded five-minute experience still requires beginner visitor playtesting.

## Generated incidents (facilitator spoilers)

The source can be `update.txt`, `maintenance.txt` or `bulletin.txt`. Source, event time, job identifier and inventory are generated together. Snapshot A, B or C can be valid; compare timestamps and integrity rather than memorising a letter. Consecutive teams get different incident profiles and passphrases.

The correct first sensor record is the initial voltage drop, before the later operator observation. The supporting log is the imported filename in `incident.log`; choose line 3 of that attachment. Diagnose **Prompt injection**. Quarantine that source, restore the PASS snapshot before the event, then enable alerts. Stage hints derive from the current incident and provide its exact walkthrough.

## Dashboard

Readings are fictional mission records, not real-world live telemetry. The chart plots records in order; the table gives exact timestamps. Recovery adds confirmation records only after the server accepts each action. Sensor and AI claims are shown separately. The dashboard remains visible on the result screen and locks again for each new mission. Its main table shows time, voltage and AI report. The voltage chart and AI conversation are optional and collapsed by default.


## Sessions and resilience

The browser stores only the mission ID in sessionStorage. Refresh restores the original deadline, stage, collected files, selected instruction, hints, recovery steps and controller conversation. It does not grant extra event time. Temporary failures offer a connection retry rather than silently starting a new team. Revision checks prevent stale responses from undoing progress.

The terminal retains the last 50 commands. Collected file evidence and the selected instruction persist separately, so a long transcript does not remove recovery clues. Sessions are isolated in memory. Event/completed sessions are retained for roughly 30 minutes; unfinished practice sessions expire after 24 hours without requests. Deploy one Node process/instance until a shared session store is added.

## Optional Gemini

Set `GEMINI_API_KEY` privately in `.env` or the backend host. Configure `GEMINI_MODEL` as needed. The default is `gemini-3.1-flash-lite`; supported request timeout is 100–60000 ms. The AI uses the team's incident time and job identifier and does not decide puzzle answers. Missing keys, provider errors or timeouts use scripted dialogue consistent with that incident. Backend tests mock provider requests; they do not verify a live key.

Set `GEMINI_API_KEY` privately in `.env` or the backend host. Configure `GEMINI_MODEL` as needed. The default is `gemini-3.1-flash-lite`; supported request timeout is 100–60000 ms. The AI uses the team's incident time and job identifier and does not decide puzzle answers. Missing keys, provider errors or timeouts use scripted dialogue consistent with that incident. Backend tests mock provider requests; they do not verify a live key.

The Express server serves the frontend locally. For Vercel frontend + Render backend:

The Express server serves the frontend locally. For Vercel frontend + Render backend:

- Backend: `npm install`, start `npm start`; set `FRONTEND_ORIGIN` to the exact frontend HTTPS origin and configure private AI environment variables there.
- Frontend: set `BACKEND_URL` to the backend HTTPS origin, run `npm run build:frontend`, publish `dist`.
- Deploy both frontend and backend together: evidence and recovery endpoints are new and incompatible with the old two-dropdown/one-submit flow.
- The frontend build copies public assets only. Never expose `.env` or a Gemini key in frontend settings.

See [frontend/API notes](docs/FRONTEND.md) for the updated contracts.

## Beginner-flow verification

Automated tests cover the full typed-command journey, harmless/wrong line retries, forbidden unread selections, refresh, recovery order, session isolation, offsets and the public frontend build. Deploy frontend and backend together because the instruction-selection API replaces manual evidence pinning.
