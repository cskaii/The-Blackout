# The Blackout — frontend and API notes

## State-driven game

The backend is authoritative for mode, deadline, stage, incident, evidence pins, diagnosis and recovery. Stage 1 unlocks the monitoring dashboard. Stage 2 requires the first conflicting record and a supported diagnosis. Stage 3 uses separate quarantine, restore and verify actions. Success exposes a server-built incident replay.

All session requests use `x-session-id`. POST bodies are JSON. `/api/state` returns state directly; actions return `{ok, message, state}`. HTTP 200 with `ok:false` is a rejected puzzle choice, not permission to advance.

| Method | Endpoint | Body |
| --- | --- | --- |
| POST | /api/start | `{mode: "event"}` or `{mode: "practice"}`; omitted mode defaults to event |
| GET | /api/state | None |
| POST | /api/answer | Stage 1: `{stage:1,value:"decoded words"}` |
| POST | /api/terminal | `{command:"cat incident.log"}`; 1–150 characters |
| POST | /api/evidence | `{action:"record",id:"sensor:record-id"}` to verify/pin first contradiction; `{action:"pin",id:"file:filename:lineIndex"}` or `{action:"unpin",id:"..."}` for examined excerpts |
| POST | /api/answer | Stage 2: `{stage:2,value:"attack-id:filename",evidence:[sensorId,logId,instructionId]}`; all three must be valid, pinned supporting evidence |
| POST | /api/recovery | `{action:"quarantine",target:"filename"}`, then `{action:"restore",target:"a"}`, then `{action:"verify",target:"enable-alerts"}` |
| POST | /api/hint | `{}` |
| POST | /api/ai | `{questionId:"grid-status"}` or `{message:"Question"}`; 1–300 characters |

IDs in this table illustrate the format; render actual IDs/text from state rather than hard-coding incident answers. Stage 3 `/answer` submissions cannot bypass recovery order. File shortcuts call the same terminal endpoint as typed commands.

## State fields

| Field | Meaning |
| --- | --- |
| revision | Monotonic mutation counter; discard older responses |
| mode | event or practice; immutable during a mission |
| remainingSeconds | Server countdown for event mode; null for practice |
| elapsedSeconds | Elapsed mission time; frozen after completion |
| finished / expired / stage | Mission and navigation state |
| cipher | Encrypted two-word message and failed-cell count |
| fileNames | Available filenames after Stage 1; includes decoys |
| readFiles / evidenceReady | Examined files and whether incident source, log and inventory were read |
| collectedEvidence | `{file,content}` for examined files, independent of rolling transcript |
| evidence | `selectedRecord`, pinned IDs, available cards `{id,kind,label,text}`; file cards appear only after examination |
| recovery | Step 0–3 plus confirmed source and snapshot; each server confirmation unlocks the next action |
| monitoring | null in Stage 1; otherwise phase, sourceStatus, comparison, latest and samples. Samples contain id, time, voltage, grid, alerts, report and event |
| replay | Empty before success; ordered `{time,title,text}` incident explanation afterwards |
| terminalHistory | Last 50 `{command,output}` turns |
| revealedHints / hintsUsed | Latest progressive hint per stage and total |
| ai | Questions, pending flag, remaining allowance and conversation history |

## Frontend behavior

- Dashboard readings and model dialogue use text nodes. Never render external text as HTML.
- Refresh uses the saved session ID; reconnect errors must not create a fresh timed mission. A 401 offers a new mission.
- Polling and the visible event clock continue during form actions and AI responses. Practice never shows a fabricated countdown.
- Form selections and typed input survive ordinary polls and rejected answers. Re-render the recovery form only when its confirmed step changes.
- AI requests use a separate busy flag, pending/cooldown/request-limit guards and old-team checks. Talking to the AI is optional.
- Sound starts off and uses a user gesture. It is independent of gameplay and must not prevent completion when unsupported.
- Next-team start resets evidence, recovery, histories and dashboard visibility. Each incident's files, hints and AI context must use that team's generated profile.

## Verification

Use `npm test` for server and frontend regressions. Test event and practice modes, wrong anomaly selection, irrelevant pinned evidence, correct diagnosis, each recovery action, late responses, refresh, next-team reset and timeout. Browser layout, actual audio output, keyboard operation and visitor timing still require independent checks when browser tools are available.
