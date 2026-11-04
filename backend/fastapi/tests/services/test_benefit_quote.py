from app.services.benefit_quote import classify_quote


def _quote(rules, value=0, best=None):
    return {"rules": rules, "estimated_value_won": value, "best_rule_id": best}


def _rule(rid, status, reason, target="ELIGIBLE", unit="CASH"):
    return {
        "rule_id": rid,
        "status": status,
        "reason": reason,
        "target_status": target,
        "reward_unit": unit,
    }


def test_cafe_rule_with_met_performance_is_calculated():
    out = classify_quote(
        _quote([_rule("BR_P07_CAFE", "ELIGIBLE", "OK")], 2000, "BR_P07_CAFE")
    )
    assert out["benefit_status"] == "CALCULATED"
    assert out["expected_benefit_won"] == 2000
    assert out["benefit_unit"] == "CASH"


def test_performance_not_met_is_condition_not_met_with_zero():
    out = classify_quote(
        _quote(
            [_rule("BR_P07_CAFE", "INELIGIBLE", "PREV_MONTH_PERFORMANCE_NOT_MET")]
        )
    )
    assert out["benefit_status"] == "CONDITION_NOT_MET"
    assert out["reason"] == "PREV_MONTH_PERFORMANCE_NOT_MET"
    assert out["expected_benefit_won"] == 0


def test_missing_previous_spend_is_data_missing_not_zero_benefit():
    out = classify_quote(
        _quote([_rule("BR_P23_CAFE", "UNRESOLVED", "PREVIOUS_SPEND_MISSING")])
    )
    assert out["benefit_status"] == "DATA_MISSING"
    assert out["reason"] == "PREVIOUS_SPEND_MISSING"


def test_non_target_merchant_is_not_applicable():
    out = classify_quote(
        _quote([_rule("R", "INELIGIBLE", "CATEGORY_NOT_MATCHED", target="INELIGIBLE")])
    )
    assert out["benefit_status"] == "NOT_APPLICABLE"


def test_unresolved_other_rule_does_not_hide_resolved_benefit():
    out = classify_quote(
        _quote(
            [
                _rule("BR_P07_CAFE", "ELIGIBLE", "OK"),
                _rule("OTHER", "UNRESOLVED", "TARGET_NOT_RESOLVED", target=None),
            ],
            2000,
            "BR_P07_CAFE",
        )
    )
    assert out["benefit_status"] == "PARTIAL"
    assert out["expected_benefit_won"] == 2000
    assert out["unresolved_rule_ids"] == ["OTHER"]


def test_no_rules_is_data_missing():
    assert classify_quote(_quote([]))["benefit_status"] == "DATA_MISSING"
