"""일반 카드 혜택 견적(quote_mvp_card)의 결과를 화면용 상태로 분류한다.

0원이 나온 이유를 구분하기 위한 모듈이며, 혜택 금액을 새로 만들거나
미충족 조건을 충족으로 바꾸지 않는다.

benefit_status
- CALCULATED: 모든 규칙이 확정되어 혜택이 산정됨
- PARTIAL: 일부 규칙이 미확정이지만 확정된 규칙 기준 혜택이 있음
- CONDITION_NOT_MET: 대상 가맹점이지만 실적·최소금액·횟수·한도 조건 불충족
- NOT_APPLICABLE: 이 가맹점·기간·채널은 혜택 대상이 아님
- DATA_MISSING: 전월 실적 등 계산에 필요한 데이터가 부족함
- ERROR: 계산 엔진 오류
"""

from __future__ import annotations

UNRESOLVED_STATUSES = frozenset({"UNRESOLVED", "PENDING_REVIEW"})


def classify_quote(quote: dict) -> dict:
    rules = quote.get("rules") or []
    best_value = max(int(quote.get("estimated_value_won") or 0), 0)
    best_rule_id = quote.get("best_rule_id")

    unresolved = [r for r in rules if r.get("status") in UNRESOLVED_STATUSES]
    not_met = [
        r
        for r in rules
        if r.get("status") == "INELIGIBLE" and r.get("target_status") == "ELIGIBLE"
    ]

    best_rule = next(
        (r for r in rules if best_rule_id and r.get("rule_id") == best_rule_id),
        None,
    )

    if best_value > 0 and best_rule is not None:
        return {
            "benefit_status": "PARTIAL" if unresolved else "CALCULATED",
            "reason": (
                "UNRESOLVED_RULES"
                if unresolved
                else best_rule.get("reason") or "BENEFIT_APPLIED"
            ),
            "benefit_unit": best_rule.get("reward_unit"),
            "expected_benefit_won": best_value,
            "unresolved_rule_ids": [r.get("rule_id") for r in unresolved],
        }

    if not rules:
        status, reason = "DATA_MISSING", "NO_BENEFIT_RULES"
    elif unresolved:
        status = "DATA_MISSING"
        reason = unresolved[0].get("reason") or "UNRESOLVED_RULES"
    elif not_met:
        status = "CONDITION_NOT_MET"
        reason = not_met[0].get("reason") or "CONDITION_NOT_MET"
    else:
        status = "NOT_APPLICABLE"
        reason = rules[0].get("reason") or "NOT_APPLICABLE"

    return {
        "benefit_status": status,
        "reason": reason,
        "benefit_unit": None,
        "expected_benefit_won": 0,
        "unresolved_rule_ids": [r.get("rule_id") for r in unresolved],
    }
