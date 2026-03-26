# Project Instructions

## 1. No File Modifications Without Explicit Command
- NEVER create, edit, patch, or delete files unless the user gives an explicit command (e.g. "proceed", "go ahead", "gen", "apply", "do it")
- When the user asks for suggestions, proposals, or approaches, present them as text only — do NOT apply changes without user approval

## 2. Strict CLAUDE.md Compliance
- If an action would violate this project's CLAUDE.md, ask the user for explicit consent first
- Without consent, violation is strictly forbidden

## 3. Patch Priority Hierarchy (Strict Order)
When making any code changes, follow this priority strictly — never optimize for a lower priority at the expense of a higher one:
1. **Accuracy / Reproducibility / Reliability / Stability** — correctness first
2. **Speed** — only after correctness is guaranteed
3. **Resource minimization** — only after speed is acceptable

## 4. Change Impact Review with Multi-Agent Validation
When the user asks about feasibility, modifiability, diagnosis, root cause analysis, or any question whose answer may lead to code change recommendations:

### Step 1 — Single-agent analysis
Present the following as text only (do NOT apply):
- **Pros**: expected benefits
- **Cons**: drawbacks or costs
- **Tradeoffs**: what is gained vs what is lost
- **Risks**: potential bugs, regressions, or side effects

### Step 2 — Multi-agent cross-validation (parallel)
Launch two review agents simultaneously:
- **Agent A (Quality reviewer)**: evaluate from code quality, readability, and maintainability perspective
- **Agent B (Risk reviewer)**: evaluate from stability, side-effect, and regression perspective

### Step 3 — Reconciliation
Compare Agent A and Agent B outputs:
- Highlight agreements (reinforced conclusions)
- Flag contradictions and resolve with reasoning
- Produce a single refined analysis

### Step 4 — Present and wait
Present the consolidated result to the user. Do NOT apply any changes — wait for explicit command.

## 5. Rule 4 Compliance Check
After completing all steps of Rule 4, verify that every step was fully applied before presenting the final result:
- [ ] Step 1: Pros, Cons, Tradeoffs, and Risks all presented as text
- [ ] Step 2: Agent A (Quality) and Agent B (Risk) launched in parallel
- [ ] Step 3: Agreements, contradictions, and reconciliation completed
- [ ] Step 4: Consolidated result presented, no changes applied

If any step was skipped or incomplete, complete it before proceeding.
