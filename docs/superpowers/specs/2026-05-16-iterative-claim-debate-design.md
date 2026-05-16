# Iterative Claim-Level Debate for LLM Council Plus

## Summary

Extend LLM Council Plus with iterative debate rounds and three critique modes (free-form, paragraph-level, claim-level). Models receive targeted feedback between rounds, can revise their own arguments, and cross-pollinate by seeing top-rated claims from other models. The system converges when rankings stabilize or a max round limit is reached.

**Phased delivery**: Phase 1 ships multi-round free-form debate (smallest delta, proves the round loop). Phase 2 adds paragraph-level and claim-level critique modes on top.

## Decisions

- **Approach**: Enriched Stage 2 — keep the existing 3-stage architecture, make Stage 2 mode-aware
- **Critique modes**: Mutually exclusive (radio button), fundamentally different prompts and parsers
- **Round feedback**: Targeted revision — each model gets its own critiques + top claims from others
- **Claim UI**: Claim cards (grouped by source model, sortable by score, collapsible critiques)
- **Convergence**: Ranking-order based, claim stability is metadata-only in v1
- **Phased rollout**: Phase 1 = multi-round free-form. Phase 2 = claim + paragraph modes.

---

## 1. Critique Modes & Data Model

Three mutually exclusive modes, selected via radio button in Settings (Council Config section). Setting name: `critique_mode`. Default: `"freeform"`.

### Free-form (current behavior) — Phase 1

Stage 2 output per evaluator — unchanged from today, plus `round` field:

```json
{
  "model": "...",
  "ranking": "full text...",
  "parsed_ranking": ["Response A", "Response C", "Response B"],
  "mode": "freeform",
  "round": 1
}
```

### Paragraph-level — Phase 2

Stage 2 output per evaluator:

```json
{
  "model": "...",
  "ranking": "full text...",
  "parsed_ranking": ["Response A", "Response C", "Response B"],
  "mode": "paragraph",
  "round": 1,
  "annotations": [
    {
      "response_label": "Response A",
      "paragraph": 1,
      "verdict": "strong",
      "comment": "Clear thesis with evidence"
    },
    {
      "response_label": "Response A",
      "paragraph": 2,
      "verdict": "flawed",
      "comment": "Conflates correlation with causation"
    }
  ]
}
```

Verdict values: `"strong"`, `"weak"`, `"flawed"`.

**Paragraph identity**: The backend pre-segments each Stage 1 response into numbered paragraphs before building the Stage 2 prompt. Paragraphs are split on double-newlines. Each evaluator receives pre-numbered text like `[Para 1] ...text... [Para 2] ...text...` so paragraph IDs are stable across evaluators.

### Claim-level — Phase 2

**Canonical claim extraction**: Before peer evaluation, a single LLM call decomposes each response into claims. This produces a canonical claim list that all evaluators rate. Evaluators do NOT independently invent claims.

Stage 2 has two sub-steps in claim mode:

**Step 2a — Extract claims** (one LLM call per response, or one call for all):
```json
{
  "Response A": [
    {"id": "A1", "claim": "Quantum computers use qubits that exist in superposition"},
    {"id": "A2", "claim": "Current quantum computers have 10 million qubits"}
  ],
  "Response B": [
    {"id": "B1", "claim": "Error correction remains the primary bottleneck"}
  ]
}
```

**Step 2b — Evaluate canonical claims** (each evaluator rates the same claims):
```json
{
  "model": "...",
  "ranking": "full text...",
  "parsed_ranking": ["Response A", "Response C", "Response B"],
  "mode": "claim",
  "round": 1,
  "claim_verdicts": {
    "A1": {"verdict": "strong", "reason": "Accurate and well-stated"},
    "A2": {"verdict": "flawed", "reason": "Incorrect — current state of art is ~1000 qubits"},
    "B1": {"verdict": "strong", "reason": "Well-supported"}
  }
}
```

This solves the claim identity problem — `A1` means the same claim for every evaluator because they all evaluate the same canonical list.

All three modes always produce `parsed_ranking` for convergence detection and aggregate scoring.

---

## 2. Stage 2 Prompts Per Mode

### Prompt override behavior

When `critique_mode` is not `"freeform"`, the mode-specific built-in prompt is used for Stage 2 regardless of `settings.stage2_prompt`. The user's custom Stage 2 prompt only applies in free-form mode.

Settings UI shows a note: "Custom Stage 2 prompt is used only in Free-form critique mode. Paragraph and Claim modes use built-in prompts."

Same rule for round-aware Stage 1 prompts: when `round_number > 1`, the mode-specific revision prompt overrides `settings.stage1_prompt`. Round 1 always uses `settings.stage1_prompt`.

Stage 3 final prompt: when `is_final_round` and `critique_mode != "freeform"`, the mode-specific final prompt overrides `settings.stage3_prompt`. Non-final rounds and free-form mode use `settings.stage3_prompt`.

### Free-form prompt

Unchanged — current `STAGE2_PROMPT_DEFAULT` in `prompts.py`.

### Paragraph-level prompt — Phase 2

```
STAGE2_PARAGRAPH_PROMPT = """You are evaluating responses to: {user_query}

{search_context_block}
{responses_text}

For EACH response, evaluate EACH paragraph (paragraphs are pre-numbered as [Para 1], [Para 2], etc.):
- Rate each: STRONG, WEAK, or FLAWED
- Explain why in one sentence

You MUST respond with valid JSON followed by your ranking.

PARAGRAPH EVALUATION JSON:
```json
[
  {{"response": "Response A", "paragraph": 1, "verdict": "strong", "comment": "reason"}},
  {{"response": "Response A", "paragraph": 2, "verdict": "flawed", "comment": "reason"}}
]
```

FINAL RANKING:
1. Response A
2. Response B"""
```

### Claim extraction prompt — Phase 2

```
CLAIM_EXTRACTION_PROMPT = """Decompose each response into individual claims (specific, falsifiable statements).

{responses_text}

Respond with ONLY valid JSON:
```json
{{
  "Response A": [
    {{"id": "A1", "claim": "specific falsifiable statement"}},
    {{"id": "A2", "claim": "another statement"}}
  ],
  "Response B": [
    {{"id": "B1", "claim": "statement"}}
  ]
}}
```"""
```

### Claim evaluation prompt — Phase 2

```
STAGE2_CLAIM_PROMPT = """You are evaluating responses to: {user_query}

{search_context_block}
{responses_text}

These claims have been extracted from the responses. Rate each one:

{canonical_claims_text}

You MUST respond with valid JSON followed by your ranking.

CLAIM EVALUATION JSON:
```json
{{
  "A1": {{"verdict": "strong", "reason": "one sentence"}},
  "A2": {{"verdict": "flawed", "reason": "one sentence"}}
}}
```

FINAL RANKING:
1. Response A
2. Response B"""
```

### Parsers

**JSON-first with repair fallback**: All structured output (paragraph annotations, claim evaluations) is requested as JSON. Parsing strategy:

1. Extract JSON block from between ` ```json ` and ` ``` ` markers
2. Attempt `json.loads()`
3. If malformed, attempt repair: strip trailing commas, fix unquoted keys, truncate at last valid brace
4. If repair fails, structured data is `null` — UI falls back to free-form display

The `FINAL RANKING:` section is always parsed by the existing `parse_ranking_from_text()` regardless of mode.

New functions:
- `parse_paragraph_annotations(text) -> Optional[List[Dict]]` — extracts JSON block from `PARAGRAPH EVALUATION JSON:` section
- `parse_claim_evaluations(text) -> Optional[Dict[str, Dict]]` — extracts JSON block from `CLAIM EVALUATION JSON:` section
- `extract_json_block(text, marker) -> Optional[str]` — shared helper to find JSON between markers
- `repair_json(text) -> Optional[Any]` — attempt to fix common LLM JSON errors

---

## 3. Iterative Rounds with Claim-Aware Feedback

When `debate_rounds > 1`, the Round N+1 Stage 1 prompt changes based on critique mode.

### Round N+1 Stage 1 prompt (claim-level mode) — Phase 2

```
STAGE1_ROUND_N_CLAIM_PROMPT = """You are refining your answer in Round {round_number} of a multi-round deliberation.

Original question: {user_query}
{search_context_block}

YOUR PREVIOUS RESPONSE had these claims evaluated by peers:
{own_claims_with_critiques}

TOP-RATED CLAIMS FROM OTHER MODELS (for your consideration):
{top_claims_from_others}

Your task:
- Fix or drop claims rated FLAWED
- Strengthen claims rated WEAK
- Keep claims rated STRONG
- Consider incorporating top-rated claims from others if they improve your argument
- You may add new claims not previously considered

Provide your revised, improved response."""
```

`own_claims_with_critiques` format:
```
- A1: "Quantum computers use qubits in superposition" — STRONG (3/4 evaluators agree)
- A2: "Current quantum computers have 10M qubits" — FLAWED: "Actual count is ~1000" (4/4 agree)
```

`top_claims_from_others` format:
```
- B2: "Error correction remains the primary bottleneck" — STRONG (4/4 evaluators agree)
- C1: "Quantum advantage varies by problem domain" — STRONG (3/4 evaluators agree)
```

### Round N+1 Stage 1 prompt (paragraph-level mode) — Phase 2

```
STAGE1_ROUND_N_PARAGRAPH_PROMPT = """You are refining your answer in Round {round_number} of a multi-round deliberation.

Original question: {user_query}
{search_context_block}

YOUR PREVIOUS RESPONSE had these paragraphs evaluated by peers:
{own_paragraphs_with_critiques}

TOP-RATED PARAGRAPHS FROM OTHER MODELS (for your consideration):
{top_paragraphs_from_others}

Your task:
- Rewrite paragraphs rated FLAWED
- Strengthen paragraphs rated WEAK
- Keep paragraphs rated STRONG
- Consider incorporating strong points from others

Provide your revised, improved response."""
```

### Round N+1 Stage 1 prompt (free-form mode) — Phase 1

```
STAGE1_ROUND_N_FREEFORM_PROMPT = """You are refining your answer in Round {round_number} of a multi-round deliberation.

Original question: {user_query}
{search_context_block}

Previous round's best synthesis:
{previous_synthesis}

Previous round's ranking results:
{previous_rankings_summary}

Consider the previous round's insights. You may:
- Strengthen arguments that were ranked highly
- Challenge weaknesses identified in the rankings
- Offer new perspectives not yet considered
- Refine your position based on peer feedback

Provide your improved response."""
```

### Cross-pollination logic — Phase 2

```python
def select_top_claims_for_model(
    canonical_claims: Dict[str, List[Dict]],   # response_label -> canonical claims
    aggregated_verdicts: Dict[str, Dict],       # claim_id -> {majority_verdict, agreement, reasons}
    target_model: str,                          # model we're building context for
    label_to_model: Dict[str, str],             # response_label -> model name
    max_claims: int = 5
) -> List[Dict]:
    """
    Filter to claims from OTHER models only.
    Keep claims where majority verdict is STRONG.
    Sort by agreement ratio, take top N.
    """
```

Each model gets a **personalized Round N+1 prompt**: its own critiques + other models' best claims. The chairman gets a compacted summary (see Section 11: Token Budget).

### Per-model prompt dispatch

In Round 1, `stage1_collect_responses()` works as today — all models get the same prompt. In Round N+1 (any critique mode), each model gets a personalized prompt.

`stage1_collect_responses()` gains an optional `per_model_messages: Dict[str, List[Dict]]` parameter. When provided, each model's async task checks this dict first. If a key matching the model ID exists, it uses that message list instead of the shared one.

This changes:
- **Progress accounting**: No change — still `len(models)` total, results yield as they complete
- **History handling**: `per_model_messages` replaces the shared `messages` entirely (history is baked into each personalized prompt by the caller)
- **Error attribution**: No change — each task is still keyed by model ID

---

## 4. Convergence & Termination

### Primary convergence (all modes)

Ranking order stabilizes — top-K positions unchanged across consecutive rounds. Uses aggregate ranking order (from `calculate_aggregate_rankings()`), not individual evaluator rankings.

```python
def check_convergence(current_rankings, previous_rankings):
    if not current_rankings or not previous_rankings:
        return False
    # Only compare models present in both rounds
    current_models = {r["model"] for r in current_rankings}
    previous_models = {r["model"] for r in previous_rankings}
    common = current_models & previous_models
    if len(common) < 2:
        return True  # Degenerate: 0-1 models always "converged"
    
    current_order = [r["model"] for r in current_rankings if r["model"] in common]
    previous_order = [r["model"] for r in previous_rankings if r["model"] in common]
    
    k = math.ceil(len(current_order) / 2)
    return current_order[:k] == previous_order[:k]
```

**Edge cases**:
- **Partial rankings** (evaluator returned empty `parsed_ranking`): Excluded from aggregation, same as today
- **Failed evaluators**: Excluded from aggregation. If all evaluators fail, round is treated as non-convergent
- **Ties** (equal `average_rank`): Broken by model name alphabetically (deterministic)
- **Model set changes between rounds** (model fails in round 2 after succeeding in round 1): The failed model is excluded from convergence comparison. Its previous-round response is NOT carried forward — it simply drops from the rankings. Stage 2 only evaluates models that succeeded in the current round's Stage 1
- **Single model**: Stage 2 is skipped (no peers to rank). Convergence is immediate. Multi-round with 1 model just repeats Stage 1 with revision context and chairman synthesis. Minimum useful model count: 2

### Secondary signal (claim/paragraph modes, metadata only) — Phase 2

Logged but does not drive termination in v1:

```json
"convergence_detail": {
    "ranking_stable": true,
    "claims_stable": true,
    "flawed_claims_remaining": 2,
    "rounds_executed": 3
}
```

### Termination conditions (any one triggers)

1. Convergence threshold met (default: 2 consecutive stable rounds)
2. `debate_rounds` reached (this is the configured round count)
3. User aborts

**Setting clarification**: `debate_rounds` is how many rounds to run. `max_debate_rounds` is a validation cap (UI slider max). So if `debate_rounds=3` and `max_debate_rounds=5`, it runs 3 rounds. `max_debate_rounds` just prevents the user from setting `debate_rounds` above 5. If `auto_converge=false`, all `debate_rounds` rounds execute regardless of ranking stability.

### Final Stage 3 prompt (mode-aware)

In claim/paragraph modes (Phase 2), the chairman additionally receives a **claim survival summary**:

```
CLAIM EVOLUTION ACROSS ROUNDS:
- A1 "Qubits use superposition": SURVIVED (Strong in all 3 rounds)
- A2 "10M qubits exist": DROPPED Round 2 (Flawed — removed by author)
- B2 "Error correction is bottleneck": ADOPTED by Model A in Round 2 (Strong)
- C3 "Quantum advantage is domain-specific": NEW in Round 2, SURVIVED Round 3
```

### Claim evolution tracking — Phase 2

Claim identity across rounds relies on the canonical extraction step. Within a single round, claims have stable IDs. Across rounds, claim tracking works as follows:

- **SURVIVED**: A claim from round N appears in round N+1's canonical extraction with high semantic similarity (>0.85 cosine similarity using a lightweight embedding call, or exact substring match as a cheaper heuristic). Start with substring match; add embedding if accuracy is insufficient.
- **DROPPED**: A claim from round N has no match in round N+1's response from the same model.
- **ADOPTED**: A claim from model X in round N appears in model Y's round N+1 response (substring match against the cross-pollinated claims list).
- **NEW**: A claim in round N+1 that has no match in any round N claim.

If matching is too noisy, fall back to a simpler approach: just report per-round claim lists and let the chairman interpret evolution from the raw data.

```
STAGE3_FINAL_CLAIM_PROMPT = """You are the Chairman delivering the FINAL verdict after {total_rounds} rounds of deliberation.

Claim evolution across rounds:
{claim_evolution_summary}

Final round responses and rankings:
{stage1_text}
{stage2_text}

Deliver the definitive answer. Explain how the deliberation evolved — which claims survived scrutiny, which were dropped, and which were adopted across models. Declare the winner."""
```

Free-form final prompt remains as in Phase 1 — uses `previous_synthesis` and `previous_rankings_summary`.

---

## 5. Storage & Backward Compatibility

### Assistant message structure

**Dual-write**: New messages write both the `rounds` array AND flat `stage1`/`stage2`/`stage3` fields (containing the final round's data). This means existing UI components, the `/api/ask` endpoint, MCP tools, and any external consumers continue working without changes. The `rounds` array is additive.

```json
{
  "role": "assistant",
  "stage1": [...],
  "stage2": [...],
  "stage3": {...},
  "rounds": [
    {
      "round_number": 1,
      "stage1": [
        {"model": "openai:gpt-4.1", "response": "...", "error": null}
      ],
      "stage2": [
        {
          "model": "openai:gpt-4.1",
          "ranking": "full text...",
          "parsed_ranking": ["Response A", "Response B"],
          "mode": "claim",
          "round": 1,
          "claim_verdicts": {"A1": {"verdict": "strong", "reason": "..."}},
          "error": null
        }
      ],
      "stage3": {"model": "...", "response": "...", "error": false},
      "metadata": {
        "label_to_model": {"Response A": "openai:gpt-4.1"},
        "aggregate_rankings": [{"model": "...", "average_rank": 1.5}],
        "canonical_claims": {
          "Response A": [{"id": "A1", "claim": "..."}]
        },
        "aggregate_claim_verdicts": {
          "A1": {"majority_verdict": "strong", "agreement": 0.75, "verdicts": {"strong": 3, "weak": 1}}
        }
      }
    }
  ],
  "metadata": {
    "execution_mode": "full",
    "critique_mode": "claim",
    "debate_rounds_configured": 3,
    "debate_rounds_executed": 2,
    "converged": true,
    "convergence_round": 2,
    "convergence_detail": {
      "ranking_stable": true,
      "claims_stable": true,
      "flawed_claims_remaining": 1
    },
    "claim_evolution": [
      {"id": "A1", "origin_model": "openai:gpt-4.1", "origin_round": 1, "status": "survived"},
      {"id": "A2", "origin_model": "openai:gpt-4.1", "origin_round": 1, "status": "dropped", "dropped_round": 2},
      {"id": "B2", "origin_model": "anthropic:claude-sonnet-4", "origin_round": 1, "status": "adopted_by", "adopted_by": "openai:gpt-4.1", "adopted_round": 2}
    ],
    "search_context": "...",
    "search_query": "..."
  }
}
```

**The flat fields** (`stage1`, `stage2`, `stage3` at top level) always contain the **final round's** data. This is what existing code reads.

### Backward compatibility

1. **Old conversations** (no `rounds` key): No migration needed. Flat `stage1`/`stage2`/`stage3` are read directly by existing code. Frontend checks for `rounds` key — if absent, renders as today. No read-only migration, no wrapping.
2. **Single-round new conversations** (`debate_rounds: 1`): Write both flat fields and `rounds: [{ round_number: 1, ... }]`. Single code path. `rounds` is ignored by existing components.
3. **Stage 2 data without `claim_verdicts`/`annotations`**: Free-form mode. Frontend checks `mode` field — if absent, treats as `"freeform"`.
4. **Import/export**: `rounds` and new metadata fields are included in export. Import of old-format data works because flat fields are still primary.

### Partial persistence on abort

When the user aborts mid-debate:
- Completed rounds are saved in `rounds` array
- The flat `stage1`/`stage2`/`stage3` fields contain whichever stages completed in the last attempted round
- `metadata.debate_rounds_executed` reflects how many rounds completed fully
- `metadata.aborted = true`

`add_assistant_message()` gains a new signature variant:

```python
def add_assistant_message(
    conversation_id: str,
    stage1: List[Dict[str, Any]],
    stage2: Optional[List[Dict[str, Any]]] = None,
    stage3: Optional[Dict[str, Any]] = None,
    metadata: Optional[Dict[str, Any]] = None,
    rounds: Optional[List[Dict[str, Any]]] = None,    # NEW
    conversation: Optional[Dict[str, Any]] = None
):
```

When `rounds` is provided, it's saved alongside the flat fields.

---

## 6. Streaming Endpoint (`main.py`)

The spec explicitly addresses `main.py`, since that's where streaming orchestration lives.

### Current flow (`main.py:315-503`)

```
event_generator():
  search → stage1_collect_responses → stage2_collect_rankings → stage3_synthesize_final → save
```

### New flow

When `debate_rounds > 1` OR `critique_mode != "freeform"`, `event_generator()` delegates to `run_iterative_debate()` which yields SSE-ready dicts. The endpoint wraps each dict as `data: {json}\n\n`.

When `debate_rounds == 1` AND `critique_mode == "freeform"`, the existing linear flow is used unchanged. This is the zero-risk path for Phase 1 — the round loop is opt-in.

```python
# In event_generator():
settings = get_settings()
if settings.debate_rounds > 1 or settings.critique_mode != "freeform":
    async for event in run_iterative_debate(
        body.content, search_context, request, body.execution_mode,
        models_override=body.council_models, chairman_override=body.chairman_model,
        history=history
    ):
        yield f"data: {json.dumps(event)}\n\n"
        await asyncio.sleep(0.01)
else:
    # existing linear flow unchanged
    ...
```

### SSE events

All existing events gain an optional `round` field. When `round` is absent, it's round 1 (backward compatible).

New event types (additive):

| Event | Data | When |
|-------|------|------|
| `round_start` | `{round: N, total_rounds: M}` | Each round begins |
| `round_complete` | `{round: N}` | Each round finishes |
| `convergence` | `{round: N, message: str}` | Auto-converge triggers |
| `debate_complete` | `{total_rounds_executed: N}` | All rounds done, followed by existing `complete` event |

The existing `complete` event is still emitted last (after `debate_complete`). The existing `stage1_*`, `stage2_*`, `stage3_*` events are emitted within each round with `round` field added.

### Disconnect checks

`run_iterative_debate()` checks `request.is_disconnected()`:
- Before starting each round
- Between Stage 1 and Stage 2 within a round
- Between Stage 2 and Stage 3 within a round
- The existing per-task disconnect checks within `stage1_collect_responses()` and `stage2_collect_rankings()` remain

On disconnect during multi-round: save completed rounds to storage before raising `CancelledError`.

### Non-streaming endpoints

- **`/api/conversations/{id}/message`** (sync, `main.py:506`): Calls `_run_council_pipeline()`. This needs a new variant `_run_iterative_pipeline()` for multi-round, or `_run_council_pipeline()` gains `debate_rounds` awareness. Returns final round results in the existing response shape.
- **`/api/ask`** (stateless, `main.py:555`): Supports `debate_rounds` and `critique_mode` as optional request fields. When omitted, uses settings. Single-model `chat_only` shortcut remains.

### Request-level overrides

`SendMessageRequest` and `AskRequest` gain optional fields:

```python
class SendMessageRequest(BaseModel):
    content: str
    web_search: bool = False
    execution_mode: ExecutionMode = "full"
    council_models: Optional[List[str]] = None
    chairman_model: Optional[str] = None
    # NEW
    debate_rounds: Optional[int] = None       # Override settings.debate_rounds
    critique_mode: Optional[str] = None       # Override settings.critique_mode
```

When `None`, falls back to `settings.*`. When provided, used for this request only.

---

## 7. Frontend Changes

### Stage 2 display (mode-dependent)

**Free-form**: Current tab view with ranking text (unchanged).

**Paragraph-level** (Phase 2): Current tab view + colored inline annotations below each evaluator's text. Green = strong, yellow = weak, red = flawed.

**Claim-level** (Phase 2): Claim cards view. Frontend-ready shape (computed from canonical claims + aggregated verdicts):

```json
[
  {
    "id": "A1",
    "claim": "Quantum computers use qubits in superposition",
    "source_model": "openai:gpt-4.1",
    "source_label": "Response A",
    "majority_verdict": "strong",
    "agreement": 0.75,
    "evaluator_verdicts": [
      {"model": "openai:gpt-4.1", "verdict": "strong", "reason": "Accurate"},
      {"model": "anthropic:claude-sonnet-4", "verdict": "strong", "reason": "Well-stated"},
      {"model": "google:gemini-2.5-pro", "verdict": "strong", "reason": "Correct"},
      {"model": "ollama:llama3", "verdict": "weak", "reason": "Oversimplified"}
    ]
  }
]
```

This normalized shape is computed by the backend in `aggregate_claim_verdicts()` and included in per-round metadata. The frontend does not need to cross-reference canonical claims with per-evaluator verdicts.

Each card shows:

```
┌──────────────────────────────────────────────┐
│ A1  STRONG  ██████████ 3/4 agree             │
│ "Quantum computers use qubits in             │
│  superposition"                              │
│ ├─ GPT-4.1: Strong — Accurate               │
│ ├─ Claude: Strong — Well-stated              │
│ ├─ Gemini: Strong — Correct                  │
│ └─ Llama: Weak — "Oversimplified"            │
└──────────────────────────────────────────────┘
```

Cards grouped by source model, sortable by score. Per-evaluator critiques collapsible.

### Settings UI (Council Config section)

```
┌─────────────────────────────────────┐
│ Debate Settings                     │
│ ──────────────────────────────────  │
│ Critique Mode: ○ Free-form          │
│                ○ Paragraph-level     │
│                ● Claim-level         │
│                                     │
│ Number of Rounds: [1] ▼  (1-5)     │
│ ☑ Auto-Converge                     │
│ Convergence Threshold: [2] ▼        │
│                                     │
│ ℹ️ Claim-level adds ~1 extra API    │
│   call per round for extraction.    │
│   Custom Stage 2 prompt applies     │
│   only in Free-form mode.           │
│   Cost: see formula below.          │
└─────────────────────────────────────┘
```

### Round navigation — Phase 1

`RoundNavigator` component sits above stages. Round dots (completed/active), label showing "Round N of M". Hidden when `totalRounds === 1`.

### App.jsx state changes — Phase 1

The assistant message state gains:

```javascript
{
  // Existing flat fields (always present, final round data)
  stage1: [...], stage2: [...], stage3: {...},
  // New
  rounds: [],              // Accumulated completed rounds
  currentRound: 1,
  totalRounds: 1,
  converged: false,
  convergenceRound: null,
  // Existing
  loading: { search, stage1, stage2, stage3 },
  progress: { stage1: {...}, stage2: {...} },
  timers: { ... }
}
```

SSE event handling:

```javascript
case 'round_start':
  updateLastMessage(msg => ({
    ...msg,
    currentRound: event.round,
    totalRounds: event.total_rounds,
  }));
  break;

case 'round_complete':
  updateLastMessage(msg => ({
    ...msg,
    rounds: [...(msg.rounds || []), {
      round_number: event.round,
      stage1: msg.stage1,
      stage2: msg.stage2,
      stage3: msg.stage3,
      metadata: msg.metadata
    }],
    // Reset transient stage data for next round
    stage1: null, stage2: null, stage3: null,
  }));
  break;

case 'convergence':
  updateLastMessage(msg => ({
    ...msg, converged: true, convergenceRound: event.round,
  }));
  break;

case 'debate_complete':
  // No-op — `complete` event follows and triggers final cleanup
  break;
```

Existing `stage1_progress`, `stage2_progress`, etc. handlers are unchanged — they write to the flat fields which represent the current round's in-progress data.

**Stage components** (`Stage1.jsx`, `Stage2.jsx`, `Stage3.jsx`) continue to receive flat `stage1`/`stage2`/`stage3` props — they show the active round. Round navigation selects which round's data to display by swapping the flat fields.

### Claim evolution view — Phase 2

Shown after final round in Stage 3 panel (or as a sibling tab):

```
┌─ Claim Evolution ────────────────────────────┐
│ ✅ A1 "Qubits use superposition"             │
│    Round 1: Strong → Round 2: Strong → Final │
│                                              │
│ ❌ A2 "10M qubits exist"                     │
│    Round 1: Flawed → Dropped in Round 2      │
│                                              │
│ 🔄 B2 "Error correction is bottleneck"       │
│    Round 1: Strong (Model B)                 │
│    → Adopted by Model A in Round 2           │
│    → Final: Strong                           │
└──────────────────────────────────────────────┘
```

### Unchanged components

Sidebar, ChatInterface, CouncilGrid. Stage 1 display unchanged. Stage 3 text rendering unchanged (chairman output is still markdown text).

---

## 8. Backend Settings

New fields in `Settings` model (`settings.py`):

```python
# Critique Mode
critique_mode: str = "freeform"        # "freeform" | "paragraph" | "claim"

# Iterative Debate
debate_rounds: int = 1                 # Number of rounds (1 = current behavior)
max_debate_rounds: int = 5             # Validation cap (UI slider max)
auto_converge: bool = True             # Stop early if rankings stabilize
convergence_threshold: int = 2         # Consecutive stable rounds to trigger
```

### Settings API changes

`UpdateSettingsRequest` (`main.py:602`) gains:

```python
critique_mode: Optional[str] = None
debate_rounds: Optional[int] = None
max_debate_rounds: Optional[int] = None
auto_converge: Optional[bool] = None
convergence_threshold: Optional[int] = None
```

`GET /api/settings` response gains these fields. `GET /api/settings/defaults` includes defaults. Import/export includes them. Reset clears to defaults.

Validation: `critique_mode` must be one of `"freeform"`, `"paragraph"`, `"claim"`. `debate_rounds` must be 1..`max_debate_rounds`. `convergence_threshold` must be 1..`debate_rounds`.

---

## 9. Council Orchestration

New top-level function `run_iterative_debate()` in `council.py`:

```python
async def run_iterative_debate(
    user_query: str,
    search_context: str = "",
    request: Any = None,
    execution_mode: str = "full",
    models_override: Optional[List[str]] = None,
    chairman_override: Optional[str] = None,
    history: Optional[List[Dict[str, str]]] = None
) -> AsyncGenerator:
```

Responsibilities:
- Loop through rounds 1..N
- Select Stage 1 prompt based on critique mode and round number (round 1 uses standard prompt, round N>1 uses mode-specific revision prompt)
- Select Stage 2 prompt based on critique mode
- In claim mode, run canonical claim extraction (Step 2a) before peer evaluation (Step 2b)
- After Stage 2, aggregate claim/paragraph verdicts across evaluators
- Build personalized Round N+1 context per model (own critiques + top claims from others)
- Check convergence after each round
- Build claim evolution summary for final Stage 3
- Yield SSE-ready dicts for each stage within each round, plus round lifecycle events
- Check `request.is_disconnected()` between rounds and between stages
- On abort, yield partial round data for persistence

Helper functions:
- `aggregate_claim_verdicts(stage2_results, canonical_claims) -> Dict` — majority vote per canonical claim across evaluators
- `select_top_claims_for_model(canonical_claims, aggregated_verdicts, target_model, label_to_model, max_claims=5) -> List[Dict]` — cross-pollination selection
- `build_claim_evolution(rounds_data) -> List[Dict]` — trace claim lifecycle across rounds (substring match, with embedding fallback)
- `check_convergence(current_rankings, previous_rankings) -> bool` — top-K stability check on aggregate rankings
- `extract_canonical_claims(responses_text) -> Dict[str, List[Dict]]` — single LLM call to decompose responses into claims
- `pre_segment_paragraphs(response_text) -> List[str]` — split response into numbered paragraphs for stable IDs

When `debate_rounds == 1` and `critique_mode == "freeform"`, this function is NOT called — the existing linear flow in `main.py` handles it.

---

## 10. Search Context

Web search runs **once before Round 1**. The same `search_context` is reused for all rounds. Rationale:
- Search results don't change between rounds (seconds apart)
- Re-running search wastes API calls and budget
- The factual context is established once; the debate refines interpretations of that context

The `search_context` string is passed to every stage in every round.

---

## 11. Token Budget Strategy

Multi-round prompts grow with each round. Mitigation:

### Round N+1 Stage 1 prompt budget

- `own_claims_with_critiques`: Max 10 claims per model, each ~100 tokens. Budget: ~1000 tokens.
- `top_claims_from_others`: Max 5 claims. Budget: ~500 tokens.
- `search_context`: Unchanged from today (controlled by `full_content_results` setting).
- `previous_synthesis` (free-form mode): Truncated to 2000 tokens if longer.
- Total Round N+1 Stage 1 prompt: ~4000-6000 tokens (within all provider limits).

### Stage 2 prompt budget

- `responses_text`: Each response truncated to 3000 tokens if longer (preserving beginning and end).
- With 4 models: ~12000 tokens for responses + prompt overhead. Within limits.

### Chairman final prompt budget

The chairman does NOT get "everything." It receives:
- **Free-form**: Previous round's synthesis (max 2000 tokens) + current round's Stage 1 responses + current round's Stage 2 rankings. No historical rounds.
- **Claim/paragraph mode**: Claim evolution summary (compact: ~100 tokens per claim, max 30 claims = ~3000 tokens) + current round's responses + current round's rankings. No raw historical round data.

Total chairman prompt: ~15000-20000 tokens max. Well within context limits.

### Compaction rules

If any prompt section exceeds its budget:
1. Truncate long responses (keep first and last 40% of budget, insert `[...truncated...]`)
2. Drop claims with unanimous STRONG verdict from critique feedback (they don't need discussion)
3. In claim evolution, only include claims that changed status (drop SURVIVED-throughout claims)

---

## 12. Cost & Latency

### Per-mode cost formulas

| Mode | API Calls Per Round | Formula |
|------|-------------------|---------|
| Chat Only | council | `council x rounds` |
| Chat + Ranking | council x 2 | `council x 2 x rounds` |
| Full (free-form) | council x 2 + 1 | `(council x 2 + 1) x rounds` |
| Full (paragraph) | council x 2 + 1 | `(council x 2 + 1) x rounds` |
| Full (claim) | council x 2 + 2 | `(council x 2 + 2) x rounds` (extra call for claim extraction) |

Note: "+1" is the chairman call. "+2" in claim mode adds the canonical claim extraction call.

### Estimated times (4 models, Full mode)

| Rounds | Free-form Calls | Claim Calls | Estimated Time |
|--------|----------------|-------------|----------------|
| 1 (current) | 9 | 10 | ~30-60s |
| 2 | 18 | 20 | ~60-120s |
| 3 | 27 | 30 | ~90-180s |
| 5 (max) | 45 | 50 | ~150-300s |

### Token cost impact

Claim/paragraph modes do not add API calls (except the one extraction call in claim mode), but they increase output tokens per Stage 2 call by ~2-3x. With 4 models doing claim evaluation across 3 rounds, expect ~50-100k additional output tokens compared to free-form.

Rate limit warning in Settings should update dynamically based on `critique_mode`, `execution_mode`, and `debate_rounds`.

---

## 13. Implementation Order

### Phase 1: Multi-Round Free-Form Debate

1. **Backend settings** — Add `debate_rounds`, `max_debate_rounds`, `auto_converge`, `convergence_threshold`, `critique_mode` to Settings model
2. **Settings API** — Add new fields to `UpdateSettingsRequest`, `GET /api/settings`, `GET /api/settings/defaults`, import/export, reset
3. **Prompts** — Add `STAGE1_ROUND_N_FREEFORM_PROMPT` and free-form final chairman prompt
4. **Council orchestration** — `run_iterative_debate()` (free-form only), `check_convergence()`
5. **SSE events** — Wire round lifecycle events through `main.py`, delegate to `run_iterative_debate()` when `debate_rounds > 1`
6. **Storage** — Dual-write `rounds` array + flat fields in `add_assistant_message()`, partial persistence on abort
7. **Non-streaming endpoints** — Update `/api/conversations/{id}/message` and `/api/ask` for multi-round
8. **Request overrides** — Add `debate_rounds` to `SendMessageRequest` and `AskRequest`
9. **Frontend state** — Update App.jsx SSE handler for round events, add `rounds` to message state
10. **Round navigation** — `RoundNavigator` component
11. **Settings UI** — Debate round controls (critique mode radio present but paragraph/claim disabled with "Coming soon")
12. **Testing** — Multi-round free-form with 1, 2, 3 rounds; convergence; abort mid-round; backward-compatible conversation loading; single-model behavior; `/api/ask` with rounds

### Phase 2: Claim & Paragraph Critique Modes

13. **Paragraph pre-segmentation** — `pre_segment_paragraphs()` function
14. **Claim extraction** — `extract_canonical_claims()` and claim extraction prompt
15. **Prompts** — Paragraph and claim Stage 2 prompts, round-aware Stage 1 revision prompts, mode-aware final Stage 3 prompts
16. **JSON parsers** — `parse_paragraph_annotations()`, `parse_claim_evaluations()`, `extract_json_block()`, `repair_json()`
17. **Aggregation** — `aggregate_claim_verdicts()`, `select_top_claims_for_model()`, `build_claim_evolution()`
18. **Per-model prompt dispatch** — `per_model_messages` parameter in `stage1_collect_responses()`
19. **Council orchestration** — Extend `run_iterative_debate()` for claim/paragraph paths
20. **Storage** — `canonical_claims` and `aggregate_claim_verdicts` in per-round metadata
21. **Frontend: Claim cards** — New component for claim-level Stage 2 display
22. **Frontend: Paragraph annotations** — Colored inline annotations in paragraph mode
23. **Frontend: Claim evolution view** — Post-final-round summary display
24. **Settings UI** — Enable paragraph/claim radio options, critique mode note about custom prompts
25. **Request overrides** — Add `critique_mode` to request models
26. **Testing** — Each critique mode with 1 round and multi-round; claim aggregation; JSON parser edge cases; paragraph segmentation edge cases; abort mid-claim-extraction

---

## Appendix: Codex Review Response

Issues raised by Codex review and how each is addressed:

| Issue | Resolution | Section |
|-------|-----------|---------|
| `main.py` ignored | Dedicated Section 6 covering streaming endpoint | 6 |
| Stage events lack round field | All events gain optional `round` field | 6 |
| Breaking schema change | Dual-write flat + rounds | 5 |
| Migration underspecified | No migration needed — flat fields are primary | 5 |
| Claim ID identity problem | Canonical claim extraction step (Step 2a) | 1, 2 |
| Claim evolution hand-wavy | Substring match with embedding fallback, explicit fallback strategy | 4 |
| Paragraph identity problem | Backend pre-segments with stable IDs | 1 |
| Parser brittleness | JSON-first with repair fallback | 2 |
| Conflicts with customizable prompts | Mode overrides custom prompt, documented | 2 |
| `per_model_messages` complexity | Detailed behavior and non-changes | 3 |
| Convergence underspecified | Edge cases for partial/failed/ties/model changes/single model | 4 |
| Setting overlap | `debate_rounds` is count, `max_debate_rounds` is validation cap | 4 |
| Settings API missing | Added to implementation order, detailed in Section 8 | 8, 13 |
| No request-level overrides | `debate_rounds` and `critique_mode` on request models | 6 |
| `/api/ask` ignored | Addressed in Section 6 | 6 |
| Abort handling | Disconnect checks between rounds/stages, partial persistence | 5, 6 |
| Cost formula wrong | Per-mode formulas | 12 |
| Token budget strategy | Dedicated Section 11 with per-section budgets and compaction | 11 |
| Chairman context overflow | Compacted input, no raw historical data | 11 |
| Search context reuse | Run once, reuse all rounds | 10 |
| Single-model behavior | Stage 2 skipped, immediate convergence | 4 |
| Too many features bundled | Phased delivery: Phase 1 free-form, Phase 2 claim/paragraph | 13 |
| Claim UI normalized shape | Backend computes frontend-ready shape | 7 |
| Stage 1/3 display "unchanged" claim | Confirmed unchanged — stages render chairman text and model responses | 7 |
