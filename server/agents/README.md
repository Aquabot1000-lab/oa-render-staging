# OA Multi-Agent System

## Architecture
Each agent is a self-contained module with:
- `name` — unique agent identifier
- `canHandle(task)` — returns true if this agent owns the task type
- `execute(task, ctx)` — runs the task, returns result
- All actions logged to `activity_log` via Supabase

## Agents
| Agent | Responsibility | Triggers On |
|-------|---------------|-------------|
| IntakeAgent | Address validation, county resolution, data enrichment | NEW_LEAD, PRE_REGISTRATION |
| AnalysisAgent | Comp search, savings calc, retries | DATA_ENRICHED, REANALYZE |
| OutreachAgent | Initial emails/SMS (analysis results, missing notice) | ANALYSIS_COMPLETE, PARTIAL_ANALYSIS, AWAITING_NOTICE |
| FollowUpAgent | Reminders, drip sequences, timing | NEEDS_FOLLOWUP, REMINDER_DUE |
| ClosingAgent | Fee agreement, payment, filing push | READY_TO_FILE, AGREEMENT_SENT |
| QAAgent | Error detection, data consistency, wrong docs | ANY_STATE_CHANGE, DOCUMENT_UPLOADED |
| MissionControl | Task router, priority scoring, orchestrator | ALL — dispatches to other agents |

## Rules
1. No overlapping responsibilities — one agent per task type
2. All actions logged to activity_log with agent name
3. Tasks created in MC before execution starts
4. Agents never call each other directly — they emit state changes, MC routes
5. DNC/timing rules enforced by FollowUpAgent (max 5 touches, 24h cooldown)
6. QAAgent runs on every state transition as a validator

## Task Flow
```
Lead arrives → MissionControl.route()
  → IntakeAgent.execute() → status: DATA_ENRICHED
  → MissionControl.route()
  → AnalysisAgent.execute() → status: ANALYSIS_COMPLETE
  → MissionControl.route()
  → QAAgent.execute() → validates, flags issues
  → OutreachAgent.execute() → sends comms
  → ... continues through pipeline
```
