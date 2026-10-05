"""
Description: Turns Jev's bool answer and its reported margin back into the probability of yes,
then applies the block bar. The bar is owned by code, not by the model.
Index:
    - YES_CONFIDENCE_THRESHOLD: block when P(yes) for either question is at least this
    - yes_probability: P(yes) from the bool and the margin, at the agent's boolean threshold
    - blocks_on_yes_confidence: true when either field's P(yes) reaches the bar, or the
      margin is missing (fail closed)
"""

from schemas.user_text_screen import UserTextScreen

# Starting bar, recorded so it can be tuned. Pin user_text_screen_model once it is tuned.
YES_CONFIDENCE_THRESHOLD = 0.7
_FIELDS = ("prompt_injection", "harmful_request")


def yes_probability(answered_yes: bool, margin: float, *, boolean_threshold: float = 0.5) -> float:
    """Recovers P(yes). `margin` is how far the answer sits from `boolean_threshold`, 0 to 1,
    which is what Jev reports as confidence for a bool field."""
    if answered_yes:
        return boolean_threshold + margin * (1 - boolean_threshold)
    return boolean_threshold * (1 - margin)


def blocks_on_yes_confidence(
    screen: UserTextScreen, confidence: dict[str, float], *, boolean_threshold: float = 0.5
) -> bool:
    """True when either question's P(yes) is at least YES_CONFIDENCE_THRESHOLD. A missing
    margin blocks too: there is nothing to check the bar against."""
    for field in _FIELDS:
        margin = confidence.get(field)
        if margin is None:
            return True
        probability = yes_probability(getattr(screen, field), margin, boolean_threshold=boolean_threshold)
        if probability >= YES_CONFIDENCE_THRESHOLD:
            return True
    return False
