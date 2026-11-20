# The Blackout — beginner player flow and API

Players start a five-minute mission after reading the brief and a harmless `cat readme.txt` example. There is no mode picker, sound control or clickable file-reading shortcut.

1. Decode the access phrase to unlock the dashboard.
2. Choose the FIRST time supply drops to 0 V while the AI still reports ALL CLEAR.
3. Type `cat incident.log`, then `cat FILENAME` for the imported attachment named in the log.
4. Select the suspicious attachment line directly. No pinning or evidence board is required.
5. Choose the attack. The source file is filled from the selected line. The server verifies all observations and selections.
6. Stage 3 shows the incident time and backup inventory automatically. Quarantine, restore and verify monitoring in order, with dashboard confirmations.

Stage 2 has one changing next-task prompt, a compact time/voltage/AI-report table and progressive diagnosis disclosure. The voltage trend and optional controller conversation are collapsed by default. Recovery retains one form/action at a time. Hints remain optional, with a final labelled walkthrough.

## API

All session requests include `x-session-id`. POST bodies use JSON. Puzzle choices return `{ok,message,state}`; `ok:false` never advances the game. State is authoritative, including for refresh and the countdown.

| Method | Path | Body |
| --- | --- | --- |
| POST | /api/start | `{mode:"event"}` from the player UI. Backend practice mode remains available for testing |
| GET | /api/state | No body; returns state directly |
| POST | /api/answer | Stage 1: `{stage:1,value:"decoded words"}`. Stage 2: `{stage:2,value:"attack-id:filename"}` |
| POST | /api/terminal | `{command:"cat incident.log"}`; 1–150 characters |
| POST | /api/evidence | `{action:"record",id:"sensor:record-id"}` or `{action:"select",id:"file:filename:lineIndex"}`. Render IDs from state |
| POST | /api/recovery | `{action:"quarantine",target:"filename"}`, then `{action:"restore",target:"snapshot-id"}`, then `{action:"verify",target:"enable-alerts"}` |
| POST | /api/hint | `{}` |
| POST | /api/ai | `{questionId:"grid-status"}` or `{message:"Question"}` |

The old `pin`/`unpin` actions and submitted supporting-evidence arrays are no longer used. The server checks its saved selections, not claims in the diagnosis request. Unread attachment lines cannot be selected. Harmless lines can be selected, but do not pass diagnosis. Both the log and imported source must have been examined. Stage 3 cannot be completed through `/answer` or out-of-order recovery requests.

## State

| Field | Use |
| --- | --- |
| revision | Discard older state responses |
| stage / finished / expired | Navigation and control availability |
| mode / remainingSeconds | Event countdown; practice remains a test API capability |
| cipher | Encrypted phrase and failed-cell count. New offsets differ from the previous mission |
| readFiles / collectedEvidence | Examined filenames and their contents, independent of rolling terminal history |
| evidenceReady | Log and imported attachment have been read |
| evidence | `selectedRecord`, `selectedInstruction`, and available `cards` |
| evidence.cards | Sensor records and examined attachment lines with `{id,kind,file,label,text}`; no hidden/unread file contents |
| recoveryInventory / incidentTime | Null before Stage 3; shown automatically during recovery |
| recovery | Confirmed step, quarantined source and restored snapshot |
| monitoring | Sensor records, controller claims and confirmed recovery readings |
| replay | Server-built explanation after success |
| revealedHints / hintsUsed | Progressive hints and total |
| ai | Conversation, suggested questions, cooldown/pending feedback and allowance |

Refresh restores the session ID and server state without adding time. Temporary connection failures offer retry rather than creating a new mission. Ordinary polls preserve form choices; selecting a different instruction updates the source once. Text from files and AI is rendered as text nodes. Polling continues while the controller is responding.

Run `npm test` and `npm run build:frontend` (with BACKEND_URL set) before handoff. Automated completion does not establish beginner completion within five minutes; visitor playtesting is still required. Deploy frontend and backend together.
