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
    build_stage_texts,
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

    if len(common) == 0:
        return False  # No common models = can't compare = not converged
    if len(common) == 1:
        return True  # Degenerate: single common model is trivially stable

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
                    your_rank="{model_rank}",
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
                from .prompts import STAGE3_FINAL_FREEFORM_PROMPT

                search_block = ""
                if search_context:
                    search_block = f"Context from Web Search:\n{search_context}\n"

                stage1_text, stage2_text = build_stage_texts(stage1_results, stage2_results)

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
