"""LLM evaluation layer for qa-automation-lab.

Public API:
- generate_item: traced LLM call producing one synthetic Item payload.
- judge_realism: LLM-as-judge that scores realism of a generated item.
- ItemCandidate: typed wrapper around the generator's raw output.
"""

from llm_evals.generator import ItemCandidate, generate_item
from llm_evals.judge import RealismVerdict, judge_realism

__all__ = ["ItemCandidate", "RealismVerdict", "generate_item", "judge_realism"]
