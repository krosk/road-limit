# Write Agent-and-Human Docs

Documentation in this project serves two audiences:
- **Agents** (primary): reliable retrieval, unambiguous instruction, explicit contracts
- **Humans** (secondary): orientation, rationale, mental model

How they are served depends on the documentation level. At module and interface level, both audiences are served in a single file through a two-layer structure. At project and architecture level, they are served by separate files with distinct purposes.

---

## Doc structure

Docs that serve both audiences follow this two-layer layout:

**Human layer (top):** 2–5 sentences. What this component is, what problem it solves, how it fits in the larger picture. Written for a developer encountering it for the first time.

**Agent layer (below):** Flat, declarative facts. Contracts, boundaries, constraints, canonical vocabulary, explicit non-goals, and failure modes.

Keep layers distinct. Narrative does not belong in the agent layer. Terse facts do not belong in the human layer.

---

## Content by audience

### Both audiences need
- Public contracts and interfaces — what something accepts, returns, guarantees
- Boundaries — what a component owns and explicitly does not own
- Canonical vocabulary — the exact names the codebase uses for concepts
- Non-goals — what was intentionally ruled out and why

### Humans need, agents don't
- Orientation narrative — where something fits in the larger picture
- Worked examples — humans learn patterns from them
- Historical reasoning — why a decision was made, what was rejected (→ belongs in ADRs)
- Signposting — what's hard, what's a gotcha, where to be careful

### Agents need, humans don't
- Exhaustive constraint enumeration — every rule stated explicitly, even seemingly obvious ones
- Explicit failure modes — what not to do, precisely worded
- Consistent vocabulary repetition — canonical names used uniformly across docs for reliable retrieval

### Neither needs
- Implementation details the code shows clearly
- Structural descriptions an agent can map by reading the codebase
- Anything likely to be wrong within one sprint

---

## Documentation levels

### Project level
**Location:** `CLAUDE.md`, `README.md`

| Content | Audience |
|---|---|
| What the project is and what problem it solves | Both |
| Major components and how they relate | Both |
| Canonical vocabulary for the whole project | Agent |
| Where to start as a new contributor | Human |

### Architecture / decision level
**Location:** `docs/decisions/` as ADRs

| Content | Audience |
|---|---|
| Why a structural choice was made | Human |
| Alternatives considered and rejected | Human |
| Constraints that flow from the decision | Both |

Agents read ADRs when they need rationale, not as part of routine context loading.

### Module / component level
**Location:** One doc per meaningful unit of ownership

| Content | Audience |
|---|---|
| What it owns and doesn't own | Both |
| Public contract | Both |
| Explicit constraints and non-goals | Agent |
| Short orientation for first encounter | Human |

This is where the two-layer structure applies most directly.

### Interface level
**Location:** Docstrings and inline comments on public interfaces

| Content | Audience |
|---|---|
| What a function or type guarantees | Both |
| Edge cases and failure modes | Agent |
| Intent when not obvious from signature | Human |

Co-located with code — least likely to drift.

### Convention level
**Location:** `.claude/rules/<topic>.md` with path-scoped frontmatter

| Content | Audience |
|---|---|
| Naming rules, co-modification rules, validation constraints | Agent |
| Invariants that must hold when touching matching files | Agent |
| Structural templates for creating new artifacts | Agent |

Agent-primary — the human layer is lighter here (a brief heading or sentence explaining the purpose of the rules file), but still useful since these files are checked into git and maintained by humans. The agent layer uses imperative voice ("do X", "never Y"). Rules files are auto-loaded when the agent touches files matching the `paths:` frontmatter.

### Workflow level
**Location:** `.claude/skills/<name>/SKILL.md`

| Content | Audience |
|---|---|
| Step-by-step scaffolding procedures | Agent |
| Templates for creating new artifacts | Agent |
| On-demand workflows triggered by user | Agent |

Procedural — invoked explicitly, not auto-loaded. Skills should reference `.claude/rules/` for conventions rather than duplicating them. If a skill contains conventions useful beyond its trigger context (e.g., useful when editing, not just creating), extract those conventions to a rules file and have the skill reference them.

---

## Writing rules

### Agent layer
State contracts and boundaries flatly and completely:
> ✓ "Module X owns all database writes. No other module writes directly."
> ✗ "Generally, database writes tend to go through module X."

Document what is intentionally absent:
> ✓ "This module does not handle authentication. That is owned by Y."

Use the codebase's canonical vocabulary exactly. Do not paraphrase concept names.

Do not narrate structure an agent can infer by reading the code directly.

### Human layer
Explain intent and context, not implementation. A human should understand *why* this exists and *where* it fits before reading any code.

Worked examples are welcome if they aid understanding. Keep them in the human layer.

---

## File placement rules

**Module and interface level: one file, two sections.**
Human orientation and agent contract describe the same thing and change together. Do not split them — this creates a drift problem where the two files contradict each other. If the human layer is outgrowing 2–5 sentences, that content belongs in an ADR or dedicated guide, not a separate file for the same component.

**Architecture / decision level: one file per decision (ADR).**
ADRs are human-only and largely immutable once written. They do not follow the two-layer structure. Keep them out of module docs — mixing rationale into component docs pollutes the agent layer with content it doesn't need.

**Project level: separate files by convention.**
`CLAUDE.md` and `README.md` already serve different audiences by convention and should remain separate. Do not merge them.

**Convention level: one file per topic, path-scoped.**
`.claude/rules/<topic>.md` files are named after the task they guide (e.g., `microbatch-manifests.md`, `processing-module.md`), not after the artifacts they touch. Use `paths:` frontmatter to scope auto-loading. Keep each file focused on one set of related invariants.

**Workflow level: one file per skill.**
`.claude/skills/<name>/SKILL.md` files contain procedures. They should reference `.claude/rules/` for conventions rather than inlining them.

---

## When to act

### Create a new doc when:
- A new component, contract, or boundary has no coverage yet

### Amend an existing doc when:
- Public behavior has changed
- A contract, boundary, or constraint has changed
- A concept has been renamed
- A worked example would now be wrong

### Delete content when:
- It describes behavior no longer present with no replacement needed
- It contradicts the current codebase

### Do nothing when:
- The change is an internal refactor that does not affect public behavior or contracts
- The existing doc already accurately covers the change

**When in doubt: accurate and sparse beats comprehensive and stale.**

---

## Content placement check

Before writing, identify which level the content belongs to:

1. Is this about the whole project? → `CLAUDE.md` / `README.md`
2. Is this a rationale or rejected alternative? → ADR in `docs/decisions/`
3. Is this about a component's ownership and contract? → Module doc
4. Is this about a specific function or type? → Docstring / inline comment
5. Is this an invariant that applies whenever touching certain files? → `.claude/rules/<topic>.md`
6. Is this a step-by-step procedure triggered on demand? → `.claude/skills/<name>/SKILL.md`

Content at the wrong level is a form of staleness. Project-level narrative buried in a module doc, or interface-level details inflating an architecture doc, should be moved not just rewritten.

## Convention vs workflow extraction

When a skill contains both conventions and procedures, split them:
- **Conventions** (naming rules, validation constraints, structural invariants) → `.claude/rules/`. These apply when editing existing artifacts, not just when creating new ones.
- **Procedures** (scaffolding order, file creation steps, registration checklists) → keep in `.claude/skills/`. Reference the rules file for conventions.

A convention masquerading as a procedure gets lost — it only helps when the skill is invoked, but the agent needs it whenever it touches the relevant files.
