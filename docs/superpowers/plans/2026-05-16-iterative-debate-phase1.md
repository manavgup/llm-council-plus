# Iterative Debate: Full Implementation Plan (Phase 1 + Phase 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configurable multi-round debate with three critique modes to LLM Council Plus.

**Architecture:** New `backend/debate.py` module orchestrates round loops. `stage1_collect_responses()` gains a `messages_override` param to bypass its internal prompt building for round N+1. Streaming endpoint delegates to debate orchestrator when rounds > 1. Dual-write storage preserves backward compat. Frontend handles new SSE events in existing `App.jsx` switch. Feature work done on a branch, merged via PR.

**Tech Stack:** Python/FastAPI, React, SSE streaming, JSON file storage.

**Branch:** `feat/iterative-debate`

---

## Critical Design Decisions (Codex Fixes)

These address the blocking problems identified in Codex review:

1. **`stage1_collect_responses()` prompt bypass**: Add `messages_override: Optional[List[Dict]]` param. When set, skip all internal prompt building and use these messages directly. This cleanly supports round N+1 personalized prompts.

2. **`stage3_synthesize_final()` prompt override**: Add `prompt_override: Optional[str]` param. When set, use it instead of `settings.stage3_prompt`. Enables final-round chairman prompt.

3. **Streaming control flow**: The debate orchestrator yields ALL events including `title_complete` and `complete`. The endpoint just forwards. Title gen and storage happen after the debate generator is exhausted.

4. **`chat_only` + rounds > 1**: Rejected. If `execution_mode == "chat_only"`, force `debate_rounds = 1` (no feedback loop exists without ranking). Show a validation warning in UI.

5. **`chat_ranking` + rounds > 1**: Allowed. Feedback is the aggregate ranking summary (no synthesis needed). Models see "you were ranked 3rd because..." context.

6. **`round_complete` doesn't null final round**: Only reset stage data when there's a next round coming. After the last round, keep the flat fields populated.

7. **Frontend integration**: `RoundNavigator` goes inside `ChatInterface.jsx` (where stages render), not `App.jsx`.

8. **`max_debate_rounds`**: Server constant (not a persisted setting). Hardcoded to 5. `debate_rounds` is validated 1..5.

9. **`critique_mode` in Phase 1**: Accept only `"freeform"` in Phase 1. Validate on write. Return the field in GET but reject `"paragraph"`/`"claim"` until Phase 2.

10. **Feature branch**: All work on `feat/iterative-debate`, merged via PR.

11. **Round transition UX**: Between rounds, show a brief interstitial ("Starting Round N+1... Models are revising") instead of blanking the stage area. Prevents the "answer disappeared" feeling during multi-minute debates. Cleared when `round_start` fires for the next round.

12. **Round dots are progress-only in Phase 1**: Clicking dots to browse historical rounds is deferred. User always sees the current/final round. Previous round data is stored but not browsable until Phase 2 or follow-up.

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `backend/settings.py` | Add debate settings fields |
| Modify | `backend/prompts.py` | Add round-aware prompt templates |
| Modify | `backend/council.py` | Add `messages_override` to `stage1_collect_responses()`, `prompt_override` to `stage3_synthesize_final()` |
| Create | `backend/debate.py` | `run_iterative_debate()`, `check_convergence()`, helpers |
| Modify | `backend/main.py` | Wire debate into endpoints, update request/settings models |
| Modify | `backend/storage.py` | Accept `rounds` in `add_assistant_message()` |
| Create | `backend/tests/test_debate.py` | Unit tests for convergence, truncation |
| Create | `backend/tests/test_debate_integration.py` | Mock-based orchestration tests |
| Modify | `frontend/src/App.jsx` | Handle round SSE events in state |
| Modify | `frontend/src/components/ChatInterface.jsx` | Render RoundNavigator |
| Create | `frontend/src/components/RoundNavigator.jsx` | Round progress UI |
| Create | `frontend/src/components/RoundNavigator.css` | Styling |
| Modify | `frontend/src/components/Settings.jsx` | State + props for debate settings |
| Modify | `frontend/src/components/settings/CouncilConfig.jsx` | Debate settings UI |
| Modify | `frontend/src/api.js` | Send `debate_rounds` in stream request |

---

## Phase 1: Multi-Round Free-Form Debate

### Task 1: Create Feature Branch

- [ ] **Step 1: Create and push branch**

```bash
git checkout -b feat/iterative-debate
git push -u origin feat/iterative-debate
```

---

### Task 2: Backend Settings

**Files:**
- Modify: `backend/settings.py`

- [ ] **Step 1: Add debate fields to Settings model**

After `execution_mode` field (line ~126), add:

```python
    # Iterative Debate
    critique_mode: str = "freeform"        # "freeform" only in Phase 1
    debate_rounds: int = 1                 # Number of rounds (1 = current behavior)
    auto_converge: bool = True             # Stop early if rankings stabilize
    convergence_threshold: int = 2         # Consecutive stable rounds to trigger
```

- [ ] **Step 2: Verify settings load/save**

```bash
uv run python -c "from backend.settings import Settings; s = Settings(); print(s.debate_rounds, s.auto_converge, s.critique_mode)"
```

Expected: `1 True freeform`

- [ ] **Step 3: Commit**

```bash
git add backend/settings.py
git commit -m "feat(settings): add iterative debate configuration fields"
```

---

### Task 3: Modify council.py — Add Override Params

**Files:**
- Modify: `backend/council.py:84-122` (stage1_collect_responses)
- Modify: `backend/council.py:331-449` (stage3_synthesize_final)

- [ ] **Step 1: Add `messages_override` to `stage1_collect_responses()`**

Change signature at line 84:

```python
async def stage1_collect_responses(user_query: str, search_context: str = "", request: Any = None, models_override: "List[str] | None" = None, history: "List[Dict[str, str]] | None" = None, messages_override: "List[Dict[str, str]] | None" = None) -> Any:
```

At line 122, replace:
```python
    messages = (history or []) + [{"role": "user", "content": prompt}]
```

With:
```python
    if messages_override is not None:
        messages = messages_override
    else:
        messages = (history or []) + [{"role": "user", "content": prompt}]
```

- [ ] **Step 2: Add `prompt_override` to `stage3_synthesize_final()`**

Change signature at line 331:

```python
async def stage3_synthesize_final(
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    stage2_results: List[Dict[str, Any]],
    search_context: str = "",
    chairman_override: "str | None" = None,
    prompt_override: "str | None" = None
) -> Dict[str, Any]:
```

At line 370 (prompt building), add before the try block:

```python
    if prompt_override:
        chairman_prompt = prompt_override
    else:
        try:
            # existing prompt_template logic...
```

And wrap the existing prompt building in the `else` branch.

- [ ] **Step 3: Verify existing tests pass**

```bash
uv run python -m pytest backend/tests/ -v
```

- [ ] **Step 4: Commit**

```bash
git add backend/council.py
git commit -m "feat(council): add messages_override and prompt_override params"
```

---

### Task 4: Round-Aware Prompts

**Files:**
- Modify: `backend/prompts.py`

- [ ] **Step 1: Add prompt templates**

Append to `backend/prompts.py`:

```python
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

Provide your revised, improved response."""

STAGE1_ROUND_N_CHAT_RANKING_PROMPT = """You are refining your answer in Round {round_number} of a multi-round deliberation.

Original question: {user_query}
{search_context_block}

Previous round's ranking results (how your peers ranked the responses):
{previous_rankings_summary}

Your previous response was ranked #{your_rank} out of {total_models} models.
{rank_feedback}

Provide your revised, improved response."""

STAGE3_FINAL_FREEFORM_PROMPT = """You are the Chairman delivering the FINAL verdict after {total_rounds} rounds of deliberation.

Original question: {user_query}

{search_context_block}

Previous round's synthesis:
{previous_synthesis}

This final round's individual responses:
{stage1_text}

This final round's peer rankings:
{stage2_text}

Deliver the definitive answer. Explain how the deliberation evolved across rounds and why the final position is strongest. Declare the winning perspective."""
```

- [ ] **Step 2: Verify import**

```bash
uv run python -c "from backend.prompts import STAGE1_ROUND_N_FREEFORM_PROMPT, STAGE3_FINAL_FREEFORM_PROMPT, STAGE1_ROUND_N_CHAT_RANKING_PROMPT; print('OK')"
```

- [ ] **Step 3: Commit**

```bash
git add backend/prompts.py
git commit -m "feat(prompts): add round-aware free-form debate templates"
```

---

### Task 5: Convergence Logic + Debate Orchestrator

**Files:**
- Create: `backend/debate.py`
- Create: `backend/tests/test_debate.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_debate.py`:

```python
"""Tests for iterative debate logic."""
import math
import pytest
from backend.debate import check_convergence, truncate_text

MAX_DEBATE_ROUNDS = 5


class TestConvergence:
    def test_stable_top_half(self):
        prev = [{"model": "a", "average_rank": 1.0}, {"model": "b", "average_rank": 2.0},
                {"model": "c", "average_rank": 3.0}, {"model": "d", "average_rank": 4.0}]
        curr = [{"model": "a", "average_rank": 1.2}, {"model": "b", "average_rank": 1.8},
                {"model": "d", "average_rank": 3.0}, {"model": "c", "average_rank": 4.0}]
        assert check_convergence(curr, prev) is True

    def test_unstable(self):
        prev = [{"model": "a", "average_rank": 1.0}, {"model": "b", "average_rank": 2.0},
                {"model": "c", "average_rank": 3.0}]
        curr = [{"model": "c", "average_rank": 1.0}, {"model": "a", "average_rank": 2.0},
                {"model": "b", "average_rank": 3.0}]
        assert check_convergence(curr, prev) is False

    def test_empty(self):
        assert check_convergence([], [{"model": "a", "average_rank": 1.0}]) is False
        assert check_convergence([{"model": "a", "average_rank": 1.0}], []) is False

    def test_single_model(self):
        assert check_convergence(
            [{"model": "a", "average_rank": 1.0}],
            [{"model": "a", "average_rank": 1.0}]
        ) is True

    def test_model_dropped(self):
        prev = [{"model": "a", "average_rank": 1.0}, {"model": "b", "average_rank": 2.0},
                {"model": "c", "average_rank": 3.0}]
        curr = [{"model": "a", "average_rank": 1.0}, {"model": "b", "average_rank": 2.0}]
        assert check_convergence(curr, prev) is True

    def test_no_common_models(self):
        prev = [{"model": "a", "average_rank": 1.0}]
        curr = [{"model": "x", "average_rank": 1.0}]
        # No common models with len < 2 → converged (degenerate)
        assert check_convergence(curr, prev) is True


class TestTruncateText:
    def test_short(self):
        assert truncate_text("hello", 100) == "hello"

    def test_long(self):
        text = "a" * 200
        result = truncate_text(text, 100)
        assert "[...truncated...]" in result
        assert result.startswith("a" * 50)
        assert result.endswith("a" * 50)

    def test_none(self):
        assert truncate_text(None, 100) == ""

    def test_empty(self):
        assert truncate_text("", 100) == ""
```

- [ ] **Step 2: Run to verify fail**

```bash
uv run python -m pytest backend/tests/test_debate.py -v
```

Expected: FAIL — ModuleNotFoundError

- [ ] **Step 3: Implement `backend/debate.py`**

```python
"""Iterative debate orchestration: round loops, convergence, helpers."""

import math
import asyncio
import logging
from typing import Any, AsyncGenerator, Dict, List, Optional

from .settings import get_settings
from .config import get_council_models, get_chairman_model
from .council import (
    stage1_collect_responses,
    stage2_collect_rankings,
    stage3_synthesize_final,
    calculate_aggregate_rankings,
)

logger = logging.getLogger(__name__)

MAX_DEBATE_ROUNDS = 5
MAX_SYNTHESIS_CHARS = 6000  # ~1500 tokens


def check_convergence(
    current_rankings: List[Dict[str, Any]],
    previous_rankings: List[Dict[str, Any]],
) -> bool:
    """Check if aggregate ranking order stabilized (top-K unchanged)."""
    if not current_rankings or not previous_rankings:
        return False

    current_models = {r["model"] for r in current_rankings}
    previous_models = {r["model"] for r in previous_rankings}
    common = current_models & previous_models

    if len(common) < 2:
        return True

    current_order = [r["model"] for r in current_rankings if r["model"] in common]
    previous_order = [r["model"] for r in previous_rankings if r["model"] in common]

    k = math.ceil(len(current_order) / 2)
    return current_order[:k] == previous_order[:k]


def truncate_text(text: Optional[str], max_chars: int) -> str:
    """Truncate preserving start and end."""
    if not text:
        return ""
    if len(text) <= max_chars:
        return text
    half = max_chars // 2
    return text[:half] + "\n[...truncated...]\n" + text[-half:]


def _build_rankings_summary(
    aggregate_rankings: List[Dict[str, Any]],
) -> str:
    """Format rankings as readable summary."""
    if not aggregate_rankings:
        return "No rankings available."
    lines = []
    for i, r in enumerate(aggregate_rankings, 1):
        lines.append(f"{i}. {r['model']} (avg rank: {r['average_rank']})")
    return "\n".join(lines)


def _get_model_rank(model: str, aggregate_rankings: List[Dict[str, Any]]) -> tuple:
    """Get a model's rank position and total count."""
    for i, r in enumerate(aggregate_rankings, 1):
        if r["model"] == model:
            return i, len(aggregate_rankings)
    return len(aggregate_rankings), len(aggregate_rankings)


async def run_iterative_debate(
    user_query: str,
    search_context: str = "",
    request: Any = None,
    execution_mode: str = "full",
    models_override: Optional[List[str]] = None,
    chairman_override: Optional[str] = None,
    history: Optional[List[Dict[str, str]]] = None,
    debate_rounds: Optional[int] = None,
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Orchestrate multi-round debate. Yields SSE-ready event dicts.

    The caller (main.py endpoint) is responsible for:
    - JSON-serializing and SSE-framing each yielded dict
    - Title generation (after generator exhausts)
    - Storage (using the debate_complete event's rounds data)
    - Yielding the final 'complete' event
    """
    settings = get_settings()
    num_rounds = min(
        debate_rounds if debate_rounds is not None else settings.debate_rounds,
        MAX_DEBATE_ROUNDS,
    )
    auto_converge = settings.auto_converge
    convergence_threshold = settings.convergence_threshold

    # Validate: chat_only doesn't support multi-round
    if execution_mode == "chat_only":
        num_rounds = 1

    previous_synthesis: Optional[str] = None
    previous_rankings: Optional[List[Dict[str, Any]]] = None
    all_rounds_data: List[Dict[str, Any]] = []
    convergence_count = 0
    converged = False

    for round_num in range(1, num_rounds + 1):
        if request and await request.is_disconnected():
            raise asyncio.CancelledError("Client disconnected")

        is_last_round = (round_num == num_rounds) or converged

        yield {"type": "round_start", "round": round_num, "total_rounds": num_rounds}

        # --- Build Stage 1 messages ---
        messages_override = None
        if round_num > 1:
            from .prompts import (
                STAGE1_ROUND_N_FREEFORM_PROMPT,
                STAGE1_ROUND_N_CHAT_RANKING_PROMPT,
                STAGE1_SEARCH_CONTEXT_TEMPLATE,
            )
            search_block = ""
            if search_context:
                search_block = STAGE1_SEARCH_CONTEXT_TEMPLATE.format(search_context=search_context)

            if execution_mode == "full" and previous_synthesis:
                round_prompt = STAGE1_ROUND_N_FREEFORM_PROMPT.format(
                    round_number=round_num,
                    user_query=user_query,
                    search_context_block=search_block,
                    previous_synthesis=truncate_text(previous_synthesis, MAX_SYNTHESIS_CHARS),
                    previous_rankings_summary=_build_rankings_summary(previous_rankings or []),
                )
            else:
                # chat_ranking mode: feedback from rankings only
                round_prompt = STAGE1_ROUND_N_CHAT_RANKING_PROMPT.format(
                    round_number=round_num,
                    user_query=user_query,
                    search_context_block=search_block,
                    previous_rankings_summary=_build_rankings_summary(previous_rankings or []),
                    your_rank="{model_rank}",  # placeholder, personalized below if needed
                    total_models=len(previous_rankings or []),
                    rank_feedback="Improve your response based on peer feedback.",
                )
            messages_override = [{"role": "user", "content": round_prompt}]

        # --- Stage 1 ---
        yield {"type": "stage1_start", "round": round_num}
        await asyncio.sleep(0.05)

        stage1_results: List[Dict[str, Any]] = []
        total_models = 0

        async for item in stage1_collect_responses(
            user_query,
            search_context if round_num == 1 else "",
            request,
            models_override=models_override,
            history=history if round_num == 1 else None,
            messages_override=messages_override,
        ):
            if isinstance(item, int):
                total_models = item
                yield {"type": "stage1_init", "total": total_models, "round": round_num}
                continue
            stage1_results.append(item)
            yield {
                "type": "stage1_progress",
                "data": item,
                "count": len(stage1_results),
                "total": total_models,
                "round": round_num,
            }
            await asyncio.sleep(0.01)

        yield {"type": "stage1_complete", "data": stage1_results, "round": round_num}
        await asyncio.sleep(0.05)

        if not any(r for r in stage1_results if not r.get("error")):
            yield {"type": "error", "message": "All models failed in Stage 1."}
            return

        # --- Stage 2 ---
        stage2_results: List[Dict[str, Any]] = []
        label_to_model: Dict[str, str] = {}
        aggregate_rankings: List[Dict[str, Any]] = []

        if execution_mode in ("chat_ranking", "full"):
            if request and await request.is_disconnected():
                raise asyncio.CancelledError("Client disconnected")

            yield {"type": "stage2_start", "round": round_num}
            await asyncio.sleep(0.05)

            async for item in stage2_collect_rankings(
                user_query, stage1_results, search_context, request
            ):
                if isinstance(item, dict) and not item.get("model"):
                    label_to_model = item
                    yield {"type": "stage2_init", "total": len(label_to_model), "round": round_num}
                    continue
                stage2_results.append(item)
                yield {
                    "type": "stage2_progress",
                    "data": item,
                    "count": len(stage2_results),
                    "total": len(label_to_model),
                    "round": round_num,
                }
                await asyncio.sleep(0.01)

            aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)
            yield {
                "type": "stage2_complete",
                "data": stage2_results,
                "metadata": {
                    "label_to_model": label_to_model,
                    "aggregate_rankings": aggregate_rankings,
                },
                "round": round_num,
            }
            await asyncio.sleep(0.05)

            # Convergence
            if auto_converge and previous_rankings and round_num > 1:
                if check_convergence(aggregate_rankings, previous_rankings):
                    convergence_count += 1
                else:
                    convergence_count = 0
                if convergence_count >= convergence_threshold:
                    converged = True
                    yield {
                        "type": "convergence",
                        "round": round_num,
                        "message": f"Rankings stabilized after {round_num} rounds",
                    }

            previous_rankings = aggregate_rankings

        # --- Stage 3 ---
        stage3_result: Optional[Dict[str, Any]] = None

        if execution_mode == "full":
            if request and await request.is_disconnected():
                raise asyncio.CancelledError("Client disconnected")

            yield {"type": "stage3_start", "round": round_num}
            await asyncio.sleep(0.05)

            is_final = converged or (round_num == num_rounds)

            # Build final chairman prompt for last round
            prompt_override = None
            if is_final and round_num > 1 and previous_synthesis:
                from .prompts import STAGE3_FINAL_FREEFORM_PROMPT, STAGE1_SEARCH_CONTEXT_TEMPLATE

                search_block = ""
                if search_context:
                    search_block = f"Context from Web Search:\n{search_context}\n"

                stage1_text = "\n\n".join([
                    f"Model: {r['model']}\nResponse: {r.get('response', 'No response')}"
                    for r in stage1_results if r.get('response')
                ])
                stage2_text = "\n\n".join([
                    f"Model: {r['model']}\nRanking: {r.get('ranking', 'No ranking')}"
                    for r in stage2_results if r.get('ranking')
                ])

                prompt_override = STAGE3_FINAL_FREEFORM_PROMPT.format(
                    total_rounds=round_num,
                    user_query=user_query,
                    search_context_block=search_block,
                    previous_synthesis=truncate_text(previous_synthesis, MAX_SYNTHESIS_CHARS),
                    stage1_text=stage1_text,
                    stage2_text=stage2_text,
                )

            stage3_result = await stage3_synthesize_final(
                user_query, stage1_results, stage2_results, search_context,
                chairman_override=chairman_override,
                prompt_override=prompt_override,
            )
            yield {"type": "stage3_complete", "data": stage3_result, "round": round_num}

            previous_synthesis = stage3_result.get("response", "") if stage3_result else None

        # Save round data
        round_data = {
            "round_number": round_num,
            "stage1": stage1_results,
            "stage2": stage2_results if execution_mode in ("chat_ranking", "full") else None,
            "stage3": stage3_result if execution_mode == "full" else None,
            "metadata": {
                "label_to_model": label_to_model,
                "aggregate_rankings": aggregate_rankings,
            },
        }
        all_rounds_data.append(round_data)

        yield {"type": "round_complete", "round": round_num}

        if converged:
            break

    # Final event with all data for storage
    yield {
        "type": "debate_complete",
        "total_rounds_executed": len(all_rounds_data),
        "converged": converged,
        "rounds": all_rounds_data,
    }
```

- [ ] **Step 4: Run tests**

```bash
uv run python -m pytest backend/tests/test_debate.py -v
```

Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add backend/debate.py backend/tests/test_debate.py
git commit -m "feat(debate): add orchestrator with convergence detection"
```

---

### Task 6: Wire Streaming Endpoint

**Files:**
- Modify: `backend/main.py`

- [ ] **Step 1: Add import**

At top of `main.py`, after council imports:

```python
from .debate import run_iterative_debate, MAX_DEBATE_ROUNDS
```

- [ ] **Step 2: Add `debate_rounds` to request models**

In `SendMessageRequest`:
```python
    debate_rounds: Optional[int] = None
```

In `AskRequest`:
```python
    debate_rounds: Optional[int] = None
```

- [ ] **Step 3: Restructure `event_generator()` in `send_message_stream()`**

After search is resolved (~line 373), before Stage 1 begins:

```python
            # Determine effective debate rounds
            settings = get_settings()
            effective_rounds = body.debate_rounds if body.debate_rounds is not None else settings.debate_rounds
            effective_rounds = min(max(effective_rounds, 1), MAX_DEBATE_ROUNDS)

            if effective_rounds > 1:
                # --- Multi-round debate path ---
                rounds_data = []
                final_stage1 = []
                final_stage2 = []
                final_stage3 = None
                final_label_to_model = {}
                final_aggregate_rankings = []

                async for event in run_iterative_debate(
                    body.content, search_context, request, body.execution_mode,
                    models_override=body.council_models,
                    chairman_override=body.chairman_model,
                    history=history,
                    debate_rounds=effective_rounds,
                ):
                    event_type = event.get("type")
                    yield f"data: {json.dumps(event)}\n\n"
                    await asyncio.sleep(0.01)

                    if event_type == "debate_complete":
                        rounds_data = event.get("rounds", [])
                        if rounds_data:
                            last = rounds_data[-1]
                            final_stage1 = last.get("stage1", [])
                            final_stage2 = last.get("stage2") or []
                            final_stage3 = last.get("stage3")
                            final_label_to_model = last.get("metadata", {}).get("label_to_model", {})
                            final_aggregate_rankings = last.get("metadata", {}).get("aggregate_rankings", [])

                # Title
                if title_task:
                    try:
                        title = await title_task
                        storage.update_conversation_title(conversation_id, title)
                        yield f"data: {json.dumps({'type': 'title_complete', 'data': {'title': title}})}\n\n"
                    except Exception as e:
                        print(f"Title error: {e}")

                # Storage
                metadata = {
                    "execution_mode": body.execution_mode,
                    "debate_rounds_configured": effective_rounds,
                    "debate_rounds_executed": len(rounds_data),
                    "converged": event.get("converged", False) if event else False,
                }
                if body.execution_mode in ["chat_ranking", "full"]:
                    metadata["label_to_model"] = final_label_to_model
                    metadata["aggregate_rankings"] = final_aggregate_rankings
                if search_context:
                    metadata["search_context"] = search_context
                if search_query:
                    metadata["search_query"] = search_query

                storage.add_assistant_message(
                    conversation_id,
                    final_stage1,
                    final_stage2 if body.execution_mode in ["chat_ranking", "full"] else None,
                    final_stage3 if body.execution_mode == "full" else None,
                    metadata,
                    rounds=rounds_data,
                    conversation=conversation,
                )

                yield f"data: {json.dumps({'type': 'complete'})}\n\n"

            else:
                # --- Existing single-round path (unchanged) ---
```

Indent the existing Stage 1/2/3 code into this `else` block.

- [ ] **Step 4: Add debate fields to Settings API**

In `UpdateSettingsRequest`, add:
```python
    critique_mode: Optional[str] = None
    debate_rounds: Optional[int] = None
    auto_converge: Optional[bool] = None
    convergence_threshold: Optional[int] = None
```

In `update_app_settings()`, add handling after execution_mode:
```python
    if request.critique_mode is not None:
        if request.critique_mode not in ("freeform",):  # Phase 1: only freeform
            raise HTTPException(status_code=400, detail="Only 'freeform' critique mode is supported")
        updates["critique_mode"] = request.critique_mode
    if request.debate_rounds is not None:
        if not (1 <= request.debate_rounds <= MAX_DEBATE_ROUNDS):
            raise HTTPException(status_code=400, detail=f"debate_rounds must be 1-{MAX_DEBATE_ROUNDS}")
        updates["debate_rounds"] = request.debate_rounds
    if request.auto_converge is not None:
        updates["auto_converge"] = request.auto_converge
    if request.convergence_threshold is not None:
        if not (1 <= request.convergence_threshold <= MAX_DEBATE_ROUNDS):
            raise HTTPException(status_code=400, detail="convergence_threshold must be 1-5")
        updates["convergence_threshold"] = request.convergence_threshold
```

In both GET settings and PUT settings return dicts, add:
```python
        "critique_mode": settings.critique_mode,
        "debate_rounds": settings.debate_rounds,
        "auto_converge": settings.auto_converge,
        "convergence_threshold": settings.convergence_threshold,
```

- [ ] **Step 5: Verify backend starts**

```bash
uv run python -c "from backend.main import app; print('OK')"
```

- [ ] **Step 6: Commit**

```bash
git add backend/main.py
git commit -m "feat(api): wire iterative debate into streaming and settings endpoints"
```

---

### Task 7: Storage Dual-Write

**Files:**
- Modify: `backend/storage.py:224-261`

- [ ] **Step 1: Add `rounds` parameter**

```python
def add_assistant_message(
    conversation_id: str,
    stage1: List[Dict[str, Any]],
    stage2: Optional[List[Dict[str, Any]]] = None,
    stage3: Optional[Dict[str, Any]] = None,
    metadata: Optional[Dict[str, Any]] = None,
    rounds: Optional[List[Dict[str, Any]]] = None,
    conversation: Optional[Dict[str, Any]] = None
):
```

In the message dict construction, add:
```python
    if rounds is not None:
        message["rounds"] = rounds
```

- [ ] **Step 2: Verify tests pass**

```bash
uv run python -m pytest backend/tests/ -v
```

- [ ] **Step 3: Commit**

```bash
git add backend/storage.py
git commit -m "feat(storage): dual-write rounds array in assistant messages"
```

---

### Task 8: Non-Streaming Endpoints

**Files:**
- Modify: `backend/main.py:506-599`

- [ ] **Step 1: Update `send_message_sync()` and `ask_oneshot()`**

In `send_message_sync()`, after search context, add multi-round path:

```python
    settings = get_settings()
    effective_rounds = body.debate_rounds if body.debate_rounds is not None else settings.debate_rounds

    if effective_rounds > 1:
        rounds_data = []
        async for event in run_iterative_debate(
            body.content, search_context, None, body.execution_mode,
            models_override=body.council_models,
            chairman_override=body.chairman_model,
            history=history,
            debate_rounds=effective_rounds,
        ):
            if event.get("type") == "debate_complete":
                rounds_data = event.get("rounds", [])

        last = rounds_data[-1] if rounds_data else {}
        s1 = last.get("stage1", [])
        s2 = last.get("stage2")
        s3 = last.get("stage3")
        lm = last.get("metadata", {}).get("label_to_model", {})
        ar = last.get("metadata", {}).get("aggregate_rankings", [])

        metadata = {"execution_mode": body.execution_mode, "debate_rounds_executed": len(rounds_data)}
        if body.execution_mode in ("chat_ranking", "full"):
            metadata["label_to_model"] = lm
            metadata["aggregate_rankings"] = ar
        if search_context:
            metadata["search_context"] = search_context

        storage.add_assistant_message(conversation_id, s1, s2, s3, metadata, rounds=rounds_data, conversation=conversation)
        return {"stage1": s1, "stage2": s2, "stage3": s3, "aggregate_rankings": ar or None, "label_to_model": lm or None}
```

Same pattern for `ask_oneshot()` (but without storage since it's stateless).

- [ ] **Step 2: Commit**

```bash
git add backend/main.py
git commit -m "feat(api): support multi-round in sync and oneshot endpoints"
```

---

### Task 9: Frontend — SSE Event Handling

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/api.js`

- [ ] **Step 1: Update initial assistant message state in App.jsx**

At line ~278, add new fields to the `assistantMessage` object:

```javascript
        // Iterative debate
        rounds: [],
        currentRound: 1,
        totalRounds: 1,
        converged: false,
        convergenceRound: null,
        roundTransition: false,  // true between rounds (shows interstitial)
```

- [ ] **Step 2: Add round event handlers to the switch statement**

Before the `default:` case (~line 615), add:

```javascript
            case 'round_start':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                messages[messages.length - 1] = {
                  ...lastMsg,
                  currentRound: event.round,
                  totalRounds: event.total_rounds,
                  roundTransition: false,  // Clear transition state when new round begins
                };
                return { ...prev, messages };
              });
              break;

            case 'round_complete':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                const isLastRound = event.round >= lastMsg.totalRounds || lastMsg.converged;
                messages[messages.length - 1] = {
                  ...lastMsg,
                  rounds: [...(lastMsg.rounds || []), {
                    round_number: event.round,
                    stage1: lastMsg.stage1,
                    stage2: lastMsg.stage2,
                    stage3: lastMsg.stage3,
                    metadata: lastMsg.metadata,
                  }],
                  // Only reset if more rounds coming
                  ...(isLastRound ? {} : {
                    stage1: null,
                    stage2: null,
                    stage3: null,
                    metadata: null,
                    roundTransition: true,  // Show interstitial between rounds
                    loading: { search: false, stage1: false, stage2: false, stage3: false },
                    progress: {
                      stage1: { count: 0, total: 0, currentModel: null },
                      stage2: { count: 0, total: 0, currentModel: null },
                    },
                  }),
                };
                return { ...prev, messages };
              });
              break;

            case 'convergence':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                messages[messages.length - 1] = {
                  ...lastMsg,
                  converged: true,
                  convergenceRound: event.round,
                };
                return { ...prev, messages };
              });
              break;

            case 'debate_complete':
              // No-op: 'complete' event follows immediately
              break;
```

- [ ] **Step 3: Send `debate_rounds` in api.js**

In `frontend/src/api.js`, in the `sendMessageStream` function where the POST body is built, add `debateRounds` to the payload:

```javascript
    const response = await fetch(`${API_BASE}/api/conversations/${conversationId}/message/stream?_t=${Date.now()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
      body: JSON.stringify({
        content: options.content,
        web_search: options.webSearch || false,
        execution_mode: options.executionMode || 'full',
        debate_rounds: options.debateRounds || undefined,
      }),
      signal,
    });
```

- [ ] **Step 4: Build frontend**

```bash
cd frontend && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.jsx frontend/src/api.js
git commit -m "feat(frontend): handle round lifecycle SSE events"
```

---

### Task 10: RoundNavigator Component

**Files:**
- Create: `frontend/src/components/RoundNavigator.jsx`
- Create: `frontend/src/components/RoundNavigator.css`
- Modify: `frontend/src/components/ChatInterface.jsx`

- [ ] **Step 1: Create RoundNavigator.jsx**

```jsx
import React from 'react';
import './RoundNavigator.css';

export default function RoundNavigator({ currentRound, totalRounds, converged, convergenceRound }) {
  if (!totalRounds || totalRounds <= 1) return null;

  return (
    <div className="round-navigator">
      <div className="round-dots">
        {Array.from({ length: totalRounds }, (_, i) => {
          const roundNum = i + 1;
          const isCompleted = roundNum < currentRound;
          const isActive = roundNum === currentRound;
          return (
            <div
              key={roundNum}
              className={`round-dot ${isCompleted ? 'completed' : ''} ${isActive ? 'active' : ''}`}
              title={`Round ${roundNum}`}
            />
          );
        })}
      </div>
      <span className="round-label">
        Round {currentRound} of {totalRounds}
        {converged && ` \u2014 Converged`}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Create RoundNavigator.css**

```css
.round-navigator {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  margin-bottom: 12px;
  background: rgba(59, 130, 246, 0.05);
  border: 1px solid rgba(59, 130, 246, 0.15);
  border-radius: 8px;
}

.round-dots {
  display: flex;
  gap: 6px;
}

.round-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.3);
  background: transparent;
  transition: all 0.2s ease;
}

.round-dot.completed {
  background: #3b82f6;
  border-color: #3b82f6;
}

.round-dot.active {
  border-color: #06b6d4;
  box-shadow: 0 0 6px rgba(6, 182, 212, 0.5);
}

.round-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  font-weight: 500;
}
```

- [ ] **Step 3: Integrate into ChatInterface.jsx**

Import at top:
```jsx
import RoundNavigator from './RoundNavigator';
```

In the message rendering section, above where Stage1/Stage2/Stage3 are rendered for each assistant message, add:

```jsx
{msg.totalRounds > 1 && (
  <RoundNavigator
    currentRound={msg.currentRound}
    totalRounds={msg.totalRounds}
    converged={msg.converged}
    convergenceRound={msg.convergenceRound}
  />
)}

{/* Round transition interstitial — shown between rounds while stages are reset */}
{msg.roundTransition && (
  <div className="round-transition">
    <div className="round-transition-icon">&#x27F3;</div>
    <div className="round-transition-text">
      <strong>Starting Round {msg.currentRound + 1}...</strong>
      <span>Models are revising their responses based on peer feedback</span>
    </div>
  </div>
)}
```

Add to `ChatInterface.css`:
```css
.round-transition {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  margin: 12px 0;
  background: rgba(6, 182, 212, 0.05);
  border: 1px solid rgba(6, 182, 212, 0.15);
  border-radius: 8px;
  animation: pulse-subtle 2s ease-in-out infinite;
}

.round-transition-icon {
  font-size: 24px;
  animation: spin 2s linear infinite;
}

.round-transition-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.round-transition-text strong {
  color: rgba(255, 255, 255, 0.9);
  font-size: 14px;
}

.round-transition-text span {
  color: rgba(255, 255, 255, 0.5);
  font-size: 12px;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@keyframes pulse-subtle {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}
```

- [ ] **Step 4: Build**

```bash
cd frontend && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/RoundNavigator.jsx frontend/src/components/RoundNavigator.css frontend/src/components/ChatInterface.jsx
git commit -m "feat(frontend): add RoundNavigator component in ChatInterface"
```

---

### Task 11: Settings UI

**Files:**
- Modify: `frontend/src/components/Settings.jsx`
- Modify: `frontend/src/components/settings/CouncilConfig.jsx`

- [ ] **Step 1: Add state in Settings.jsx**

Add state declarations alongside existing ones:
```javascript
const [debateRounds, setDebateRounds] = useState(1);
const [autoConverge, setAutoConverge] = useState(true);
const [convergenceThreshold, setConvergenceThreshold] = useState(2);
```

In the settings load effect, add:
```javascript
setDebateRounds(data.debate_rounds || 1);
setAutoConverge(data.auto_converge !== false);
setConvergenceThreshold(data.convergence_threshold || 2);
```

In the save handler, add to the payload:
```javascript
debate_rounds: debateRounds,
auto_converge: autoConverge,
convergence_threshold: convergenceThreshold,
```

Pass as props to CouncilConfig:
```jsx
debateRounds={debateRounds}
setDebateRounds={setDebateRounds}
autoConverge={autoConverge}
setAutoConverge={setAutoConverge}
convergenceThreshold={convergenceThreshold}
setConvergenceThreshold={setConvergenceThreshold}
```

- [ ] **Step 2: Add debate controls to CouncilConfig.jsx**

Add to props destructuring:
```javascript
    debateRounds, setDebateRounds,
    autoConverge, setAutoConverge,
    convergenceThreshold, setConvergenceThreshold,
```

Add JSX section after temperature controls:
```jsx
      {/* Debate Settings */}
      <div className="settings-group">
        <h4>Debate Settings</h4>
        <div className="setting-row">
          <label>Number of Rounds</label>
          <select value={debateRounds} onChange={(e) => setDebateRounds(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>{n}{n === 1 ? ' (single pass)' : ` rounds`}</option>
            ))}
          </select>
        </div>
        {debateRounds > 1 && (
          <>
            <div className="setting-row">
              <label>
                <input type="checkbox" checked={autoConverge} onChange={(e) => setAutoConverge(e.target.checked)} />
                Auto-converge (stop early if rankings stabilize)
              </label>
            </div>
            {autoConverge && (
              <div className="setting-row">
                <label>Convergence threshold</label>
                <select value={convergenceThreshold} onChange={(e) => setConvergenceThreshold(Number(e.target.value))}>
                  {[1, 2, 3].map((n) => (
                    <option key={n} value={n}>{n} stable round{n > 1 ? 's' : ''}</option>
                  ))}
                </select>
              </div>
            )}
            <p className="setting-hint">
              More rounds = deeper analysis, higher API cost.
              {executionMode === 'chat_only' && ' (Disabled in Chat Only mode)'}
            </p>
          </>
        )}
      </div>
```

- [ ] **Step 3: Build**

```bash
cd frontend && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Settings.jsx frontend/src/components/settings/CouncilConfig.jsx
git commit -m "feat(frontend): add debate round settings in Council Config"
```

---

### Task 12: Integration Tests

**Files:**
- Create: `backend/tests/test_debate_integration.py`

- [ ] **Step 1: Write integration tests**

```python
"""Integration tests for iterative debate orchestration."""
import asyncio
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from backend.debate import run_iterative_debate


@pytest.fixture
def mock_settings():
    s = MagicMock()
    s.debate_rounds = 2
    s.auto_converge = True
    s.convergence_threshold = 2
    s.critique_mode = "freeform"
    s.council_temperature = 0.5
    s.stage2_temperature = 0.3
    s.chairman_temperature = 0.4
    s.stage1_prompt = None
    s.stage2_prompt = None
    s.stage3_prompt = None
    s.council_models = ["model_a", "model_b"]
    return s


def _fake_stage1(*args, **kwargs):
    async def gen():
        yield 2
        yield {"model": "model_a", "response": "Answer A", "error": None}
        yield {"model": "model_b", "response": "Answer B", "error": None}
    return gen()


def _fake_stage2(*args, **kwargs):
    async def gen():
        yield {"Response A": "model_a", "Response B": "model_b"}
        yield {"model": "model_a", "ranking": "1. Response A\n2. Response B\n\nFINAL RANKING:\n1. Response A\n2. Response B", "parsed_ranking": ["Response A", "Response B"], "error": None}
        yield {"model": "model_b", "ranking": "1. Response A\n2. Response B\n\nFINAL RANKING:\n1. Response A\n2. Response B", "parsed_ranking": ["Response A", "Response B"], "error": None}
    return gen()


@pytest.mark.asyncio
async def test_two_rounds_yields_correct_events(mock_settings):
    with patch("backend.debate.get_settings", return_value=mock_settings), \
         patch("backend.debate.stage1_collect_responses", side_effect=_fake_stage1), \
         patch("backend.debate.stage2_collect_rankings", side_effect=_fake_stage2), \
         patch("backend.debate.stage3_synthesize_final", return_value={"model": "chair", "response": "Synthesis", "error": False}), \
         patch("backend.debate.get_council_models", return_value=["model_a", "model_b"]):

        events = []
        async for event in run_iterative_debate("test?", "", None, "full", debate_rounds=2):
            events.append(event)

        types = [e["type"] for e in events]
        assert types.count("round_start") == 2
        assert types.count("round_complete") == 2
        assert types.count("stage3_complete") == 2
        assert "debate_complete" in types

        # debate_complete has rounds data
        dc = next(e for e in events if e["type"] == "debate_complete")
        assert len(dc["rounds"]) == 2


@pytest.mark.asyncio
async def test_chat_only_forces_single_round(mock_settings):
    with patch("backend.debate.get_settings", return_value=mock_settings), \
         patch("backend.debate.stage1_collect_responses", side_effect=_fake_stage1):

        events = []
        async for event in run_iterative_debate("test?", "", None, "chat_only", debate_rounds=3):
            events.append(event)

        types = [e["type"] for e in events]
        assert types.count("round_start") == 1


@pytest.mark.asyncio
async def test_convergence_stops_early(mock_settings):
    mock_settings.debate_rounds = 5
    mock_settings.convergence_threshold = 1  # converge after 1 stable round

    with patch("backend.debate.get_settings", return_value=mock_settings), \
         patch("backend.debate.stage1_collect_responses", side_effect=_fake_stage1), \
         patch("backend.debate.stage2_collect_rankings", side_effect=_fake_stage2), \
         patch("backend.debate.stage3_synthesize_final", return_value={"model": "chair", "response": "Final", "error": False}):

        events = []
        async for event in run_iterative_debate("test?", "", None, "full", debate_rounds=5):
            events.append(event)

        types = [e["type"] for e in events]
        # Rankings are identical each round → converge after round 2
        assert types.count("round_start") == 2
        assert "convergence" in types


@pytest.mark.asyncio
async def test_all_models_fail_stops(mock_settings):
    def _fail_stage1(*args, **kwargs):
        async def gen():
            yield 2
            yield {"model": "model_a", "response": None, "error": True, "error_message": "timeout"}
            yield {"model": "model_b", "response": None, "error": True, "error_message": "timeout"}
        return gen()

    with patch("backend.debate.get_settings", return_value=mock_settings), \
         patch("backend.debate.stage1_collect_responses", side_effect=_fail_stage1):

        events = []
        async for event in run_iterative_debate("test?", "", None, "full", debate_rounds=2):
            events.append(event)

        types = [e["type"] for e in events]
        assert "error" in types
        assert "debate_complete" not in types
```

- [ ] **Step 2: Run tests**

```bash
uv run python -m pytest backend/tests/test_debate_integration.py -v
```

- [ ] **Step 3: Run full test suite**

```bash
uv run python -m pytest backend/tests/ -v
```

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_debate_integration.py
git commit -m "test: integration tests for multi-round debate orchestration"
```

---

### Task 13: End-to-End Verification

- [ ] **Step 1: Start backend**

```bash
uv run python -m backend.main
```

In another terminal:
```bash
curl -s http://localhost:8001/api/settings | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('debate_rounds'), d.get('auto_converge'), d.get('critique_mode'))"
```

Expected: `1 True freeform`

- [ ] **Step 2: Test settings update**

```bash
curl -s -X PUT http://localhost:8001/api/settings -H 'Content-Type: application/json' -d '{"debate_rounds": 3}' | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('debate_rounds'))"
```

Expected: `3`

- [ ] **Step 3: Reset and verify frontend builds**

```bash
curl -s -X PUT http://localhost:8001/api/settings -H 'Content-Type: application/json' -d '{"debate_rounds": 1}'
cd frontend && npm run build
```

- [ ] **Step 4: Commit any remaining changes and push**

```bash
git push origin feat/iterative-debate
```

---

## Phase 2: Claim & Paragraph Critique Modes

> Phase 2 builds on Phase 1. All tasks below assume Phase 1 is merged.

### Task 14: Paragraph Pre-Segmentation

**Files:**
- Modify: `backend/debate.py`

- [ ] **Step 1: Add paragraph segmentation function**

```python
def pre_segment_paragraphs(response_text: str) -> List[str]:
    """Split response into paragraphs on double-newlines. Returns list of paragraph strings."""
    if not response_text:
        return []
    paragraphs = [p.strip() for p in response_text.split("\n\n") if p.strip()]
    return paragraphs


def format_numbered_paragraphs(response_text: str) -> str:
    """Format response with [Para N] markers for stable evaluator references."""
    paragraphs = pre_segment_paragraphs(response_text)
    return "\n\n".join(f"[Para {i+1}] {p}" for i, p in enumerate(paragraphs))
```

- [ ] **Step 2: Commit**

```bash
git add backend/debate.py
git commit -m "feat(debate): add paragraph pre-segmentation for stable IDs"
```

---

### Task 15: JSON Parser Utilities

**Files:**
- Create: `backend/json_repair.py`
- Create: `backend/tests/test_json_repair.py`

- [ ] **Step 1: Write tests**

```python
"""Tests for JSON extraction and repair."""
from backend.json_repair import extract_json_block, repair_json


def test_extract_json_from_markdown():
    text = 'Some text\n```json\n{"key": "value"}\n```\nMore text'
    assert extract_json_block(text) == {"key": "value"}


def test_extract_json_fallback_braces():
    text = 'Preamble {"key": "value"} postamble'
    assert extract_json_block(text) == {"key": "value"}


def test_repair_trailing_comma():
    text = '{"a": 1, "b": 2,}'
    assert repair_json(text) == {"a": 1, "b": 2}


def test_repair_returns_none_on_garbage():
    assert repair_json("not json at all") is None
```

- [ ] **Step 2: Implement**

Create `backend/json_repair.py`:

```python
"""JSON extraction and repair for LLM structured output."""
import json
import re
from typing import Any, Optional


def extract_json_block(text: str) -> Optional[Any]:
    """Extract JSON from markdown code fence or raw braces."""
    if not text:
        return None

    # Try markdown fence first
    match = re.search(r'```json\s*\n(.*?)\n\s*```', text, re.DOTALL)
    if match:
        result = repair_json(match.group(1))
        if result is not None:
            return result

    # Try raw JSON (find outermost braces/brackets)
    for start_char, end_char in [('{', '}'), ('[', ']')]:
        start = text.find(start_char)
        if start == -1:
            continue
        # Find matching end
        depth = 0
        for i in range(start, len(text)):
            if text[i] == start_char:
                depth += 1
            elif text[i] == end_char:
                depth -= 1
                if depth == 0:
                    result = repair_json(text[start:i+1])
                    if result is not None:
                        return result
                    break

    return None


def repair_json(text: str) -> Optional[Any]:
    """Attempt to parse JSON with common LLM error repairs."""
    if not text:
        return None

    # Try direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Fix trailing commas
    fixed = re.sub(r',\s*([}\]])', r'\1', text)
    try:
        return json.loads(fixed)
    except json.JSONDecodeError:
        pass

    # Fix single quotes
    fixed2 = fixed.replace("'", '"')
    try:
        return json.loads(fixed2)
    except json.JSONDecodeError:
        pass

    return None
```

- [ ] **Step 3: Run tests**

```bash
uv run python -m pytest backend/tests/test_json_repair.py -v
```

- [ ] **Step 4: Commit**

```bash
git add backend/json_repair.py backend/tests/test_json_repair.py
git commit -m "feat: add JSON extraction and repair utilities for LLM output"
```

---

### Task 16: Claim Extraction + Prompts

**Files:**
- Modify: `backend/prompts.py`
- Modify: `backend/debate.py`

- [ ] **Step 1: Add Phase 2 prompts to prompts.py**

```python
CLAIM_EXTRACTION_PROMPT = """Decompose each response into individual claims (specific, falsifiable statements). Each claim should be one clear assertion.

{responses_text}

Respond with ONLY valid JSON (no other text):
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

STAGE2_PARAGRAPH_PROMPT = """You are evaluating responses to: {user_query}

{search_context_block}
{responses_text}

Paragraphs are pre-numbered as [Para 1], [Para 2], etc. Rate each: STRONG, WEAK, or FLAWED.

Respond with valid JSON followed by your ranking:

```json
[
  {{"response": "Response A", "paragraph": 1, "verdict": "strong", "comment": "reason"}},
  {{"response": "Response A", "paragraph": 2, "verdict": "flawed", "comment": "reason"}}
]
```

FINAL RANKING:
1. Response A
2. Response B"""

STAGE2_CLAIM_PROMPT = """You are evaluating responses to: {user_query}

{search_context_block}
{responses_text}

These canonical claims have been extracted. Rate each one:
{canonical_claims_text}

Respond with valid JSON followed by your ranking:

```json
{{
  "A1": {{"verdict": "strong", "reason": "one sentence"}},
  "A2": {{"verdict": "flawed", "reason": "one sentence"}}
}}
```

FINAL RANKING:
1. Response A
2. Response B"""

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

STAGE3_FINAL_CLAIM_PROMPT = """You are the Chairman delivering the FINAL verdict after {total_rounds} rounds of deliberation.

Original question: {user_query}

{search_context_block}

Claim evolution across rounds:
{claim_evolution_summary}

Final round responses:
{stage1_text}

Final round rankings:
{stage2_text}

Deliver the definitive answer. Explain which claims survived scrutiny, which were dropped, and which were adopted across models. Declare the winner."""
```

- [ ] **Step 2: Add claim extraction function to debate.py**

```python
async def extract_canonical_claims(
    responses_text: str,
    models: List[str],
) -> Optional[Dict[str, List[Dict[str, str]]]]:
    """Extract canonical claims via single LLM call. Returns {label: [{id, claim}]}."""
    from .prompts import CLAIM_EXTRACTION_PROMPT
    from .council import query_model
    from .json_repair import extract_json_block

    prompt = CLAIM_EXTRACTION_PROMPT.format(responses_text=responses_text)
    messages = [{"role": "user", "content": prompt}]

    # Use first available model for extraction
    extractor = models[0] if models else "openrouter:anthropic/claude-sonnet-4"
    response = await query_model(extractor, messages, temperature=0.2)

    if not response or response.get("error"):
        return None

    content = response.get("content", "")
    return extract_json_block(content)
```

- [ ] **Step 3: Commit**

```bash
git add backend/prompts.py backend/debate.py
git commit -m "feat(phase2): add claim extraction, paragraph/claim prompts"
```

---

### Task 17: Claim Aggregation + Cross-Pollination

**Files:**
- Modify: `backend/debate.py`

- [ ] **Step 1: Add aggregation functions**

```python
def aggregate_claim_verdicts(
    stage2_results: List[Dict[str, Any]],
) -> Dict[str, Dict[str, Any]]:
    """Aggregate per-claim verdicts across evaluators. Returns {claim_id: {majority_verdict, agreement, verdicts}}."""
    from collections import Counter

    all_verdicts: Dict[str, List[str]] = {}

    for result in stage2_results:
        claim_verdicts = result.get("claim_verdicts", {})
        for claim_id, v in claim_verdicts.items():
            all_verdicts.setdefault(claim_id, []).append(v.get("verdict", ""))

    aggregated = {}
    for claim_id, verdicts in all_verdicts.items():
        counter = Counter(verdicts)
        majority = counter.most_common(1)[0][0] if counter else "unknown"
        total = len(verdicts)
        agreement = counter[majority] / total if total > 0 else 0
        aggregated[claim_id] = {
            "majority_verdict": majority,
            "agreement": round(agreement, 2),
            "verdicts": dict(counter),
        }

    return aggregated


def select_top_claims_for_model(
    canonical_claims: Dict[str, List[Dict[str, str]]],
    aggregated_verdicts: Dict[str, Dict[str, Any]],
    target_model: str,
    label_to_model: Dict[str, str],
    max_claims: int = 5,
) -> List[Dict[str, Any]]:
    """Select top-rated claims from OTHER models for cross-pollination."""
    model_to_label = {v: k for k, v in label_to_model.items()}
    target_label = model_to_label.get(target_model)

    candidates = []
    for label, claims in canonical_claims.items():
        if label == target_label:
            continue
        for claim in claims:
            cid = claim["id"]
            verdict_info = aggregated_verdicts.get(cid, {})
            if verdict_info.get("majority_verdict") == "strong":
                candidates.append({
                    **claim,
                    "agreement": verdict_info.get("agreement", 0),
                    "source_label": label,
                })

    candidates.sort(key=lambda x: x["agreement"], reverse=True)
    return candidates[:max_claims]
```

- [ ] **Step 2: Commit**

```bash
git add backend/debate.py
git commit -m "feat(phase2): add claim aggregation and cross-pollination selection"
```

---

### Task 18: Per-Model Prompt Dispatch

**Files:**
- Modify: `backend/council.py`

- [ ] **Step 1: Add `per_model_messages` to `stage1_collect_responses()`**

Extend signature:
```python
async def stage1_collect_responses(user_query: str, search_context: str = "", request: Any = None, models_override: "List[str] | None" = None, history: "List[Dict[str, str]] | None" = None, messages_override: "List[Dict[str, str]] | None" = None, per_model_messages: "Dict[str, List[Dict[str, str]]] | None" = None) -> Any:
```

In the task dispatch section (line ~131), modify:
```python
    async def _query_safe(m: str):
        try:
            # Use per-model messages if available for this model
            model_msgs = per_model_messages.get(m, messages) if per_model_messages else messages
            return m, await query_model(m, model_msgs, temperature=council_temp)
        except Exception as e:
            return m, {"error": True, "error_message": str(e)}
```

- [ ] **Step 2: Commit**

```bash
git add backend/council.py
git commit -m "feat(council): support per-model personalized messages in Stage 1"
```

---

### Task 19: Extend Debate Orchestrator for Phase 2 Modes

**Files:**
- Modify: `backend/debate.py`
- Modify: `backend/main.py` (validation)

- [ ] **Step 1: Enable paragraph/claim modes in validation**

In `main.py` update settings validation:
```python
    if request.critique_mode not in ("freeform", "paragraph", "claim"):
        raise HTTPException(status_code=400, detail="critique_mode must be freeform, paragraph, or claim")
```

- [ ] **Step 2: Add mode-aware paths in `run_iterative_debate()`**

Extend the orchestrator to check `settings.critique_mode` and:
- In paragraph mode: call `format_numbered_paragraphs()` on responses before Stage 2
- In claim mode: call `extract_canonical_claims()` as Step 2a, then pass canonical claims to Stage 2 prompt
- Use appropriate Stage 2 prompt template based on mode
- Parse structured output via `extract_json_block()` and attach to results
- Build per-model messages for Round N+1 using claim/paragraph feedback

- [ ] **Step 3: Commit**

```bash
git add backend/debate.py backend/main.py
git commit -m "feat(phase2): extend debate orchestrator for claim and paragraph modes"
```

---

### Task 20: Frontend — Claim Cards Component

**Files:**
- Create: `frontend/src/components/ClaimCards.jsx`
- Create: `frontend/src/components/ClaimCards.css`
- Modify: `frontend/src/components/Stage2.jsx`

- [ ] **Step 1: Create ClaimCards.jsx**

```jsx
import React, { useState } from 'react';
import './ClaimCards.css';

export default function ClaimCards({ claims }) {
  if (!claims || claims.length === 0) return null;

  return (
    <div className="claim-cards">
      {claims.map((claim) => (
        <ClaimCard key={claim.id} claim={claim} />
      ))}
    </div>
  );
}

function ClaimCard({ claim }) {
  const [expanded, setExpanded] = useState(false);
  const verdictClass = claim.majority_verdict || 'unknown';
  const agreementPct = Math.round((claim.agreement || 0) * 100);

  return (
    <div className={`claim-card ${verdictClass}`}>
      <div className="claim-header" onClick={() => setExpanded(!expanded)}>
        <span className="claim-id">{claim.id}</span>
        <span className={`claim-verdict ${verdictClass}`}>{(claim.majority_verdict || '').toUpperCase()}</span>
        <span className="claim-agreement">{agreementPct}% agree</span>
      </div>
      <p className="claim-text">"{claim.claim}"</p>
      {expanded && claim.evaluator_verdicts && (
        <div className="claim-evaluators">
          {claim.evaluator_verdicts.map((ev, i) => (
            <div key={i} className="evaluator-verdict">
              <span className="ev-model">{ev.model?.split('/').pop() || ev.model}</span>
              <span className={`ev-verdict ${ev.verdict}`}>{ev.verdict}</span>
              <span className="ev-reason">{ev.reason}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create ClaimCards.css** (glassmorphic styling matching project theme)

- [ ] **Step 3: Integrate in Stage2.jsx**

When `mode === 'claim'` in the stage2 data, render `<ClaimCards>` instead of/alongside the ranking text.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ClaimCards.jsx frontend/src/components/ClaimCards.css frontend/src/components/Stage2.jsx
git commit -m "feat(frontend): add ClaimCards component for claim-level Stage 2 display"
```

---

### Task 21: Frontend — Enable Critique Mode in Settings

**Files:**
- Modify: `frontend/src/components/settings/CouncilConfig.jsx`
- Modify: `frontend/src/components/Settings.jsx`

- [ ] **Step 1: Add critique mode state and UI**

Add radio buttons for critique mode above the rounds selector:
```jsx
<div className="setting-row">
  <label>Critique Mode</label>
  <div className="radio-group">
    <label><input type="radio" name="critiqueMode" value="freeform" checked={critiqueMode === 'freeform'} onChange={(e) => setCritiqueMode(e.target.value)} /> Free-form</label>
    <label><input type="radio" name="critiqueMode" value="paragraph" checked={critiqueMode === 'paragraph'} onChange={(e) => setCritiqueMode(e.target.value)} /> Paragraph-level</label>
    <label><input type="radio" name="critiqueMode" value="claim" checked={critiqueMode === 'claim'} onChange={(e) => setCritiqueMode(e.target.value)} /> Claim-level</label>
  </div>
</div>
```

- [ ] **Step 2: Wire state in Settings.jsx**

Add `critiqueMode`/`setCritiqueMode` state, load from API, save to API, pass as prop.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/settings/CouncilConfig.jsx frontend/src/components/Settings.jsx
git commit -m "feat(frontend): enable critique mode selection in settings"
```

---

### Task 22: Phase 2 Testing

**Files:**
- Modify: `backend/tests/test_debate_integration.py`

- [ ] **Step 1: Add Phase 2 tests**

Test claim extraction, paragraph segmentation, aggregation, cross-pollination selection, JSON repair edge cases, and full orchestration in claim mode.

- [ ] **Step 2: Run full suite**

```bash
uv run python -m pytest backend/tests/ -v
cd frontend && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add backend/tests/
git commit -m "test: add Phase 2 tests for claim/paragraph critique modes"
```

---

### Task 23: Create PR

- [ ] **Step 1: Push and create PR**

```bash
git push origin feat/iterative-debate
gh pr create --title "feat: iterative claim-level debate rounds" --body "$(cat <<'EOF'
## Summary

Adds multi-round debate with three critique modes to LLM Council Plus.

- Configurable debate rounds (1-5, auto-converge)
- Three critique modes: free-form, paragraph-level, claim-level
- Targeted revision: models get per-claim feedback between rounds
- Cross-pollination: models see top-rated claims from peers
- Claim cards UI for structured critique visualization

## Phase 1 (this PR)
- Multi-round free-form debate loop
- Convergence detection
- Round navigation UI
- Settings UI for debate configuration

## Phase 2 (this PR)
- Canonical claim extraction
- Paragraph pre-segmentation
- JSON repair for LLM structured output
- Claim aggregation + cross-pollination
- Per-model personalized prompts in Stage 1
- Claim cards UI component

## Test plan
- [ ] Unit tests for convergence, truncation, JSON repair
- [ ] Integration tests for debate orchestrator (all modes)
- [ ] Manual test: 2-round free-form with 3+ models
- [ ] Manual test: claim mode with convergence
- [ ] Verify backward compat with existing conversations
- [ ] Verify settings save/load/reset

Refs: #1

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
