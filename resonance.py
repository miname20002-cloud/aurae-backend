"""
A small library of widely-known American film/TV/literature touchpoints,
organized by emotional life-theme, used purely as optional "emotional
color" for the persona — never as text to quote.

Rule, enforced in the prompt that uses this: titles and one-line themes
only. No dialogue, no lyrics, no paragraph-level summaries. Referencing a
title ("this kind of reminds me of Up") is normal conversation, not
reproduction of the work itself.

This is intentionally a starting set, not a finished cultural canon — see
README for why it should stay small and be treated as a fallback, not the
primary source of personalization (the user's own stated favorites, stored
in their insight profile, should always be preferred when known).
"""

import random

RESONANCE_MAP = {
    "grief_loss": [
        ("Up", "love that stays even after someone's gone"),
        ("Coco", "remembering someone keeps them with you"),
        ("The Fault in Our Stars", "loving someone fully even knowing it won't last forever"),
    ],
    "joy_celebration": [
        ("La La Land", "chasing a feeling that's too big to sit still for"),
        ("Mamma Mia!", "joy that doesn't need a reason, just music"),
    ],
    "coming_of_age": [
        ("Lady Bird", "messy, real growing up that doesn't look like the movies"),
        ("The Perks of Being a Wallflower", "finding your people when you didn't think you had any"),
    ],
    "nostalgia_home": [
        ("Stand By Me", "the specific ache of a summer that already feels far away"),
        ("Forrest Gump", "looking back at a whole life and seeing how it all connects"),
    ],
    "resilience_growth": [
        ("Rocky", "showing up again after getting knocked down, not winning perfectly"),
        ("Hidden Figures", "doing the work well even when no one's giving you credit yet"),
    ],
    "everyday_venting": [
        ("Friends", "the small, dumb daily stuff that somehow becomes the whole story"),
        ("Seinfeld", "nothing happened today and somehow that's the whole bit"),
    ],
    "romantic_longing": [
        ("When Harry Met Sally...", "wanting someone and not knowing if it's mutual yet"),
        ("The Great Gatsby", "longing for something that might be more idea than reality"),
    ],
    "uncertainty_transition": [
        ("The Catcher in the Rye", "feeling out of step with everyone while you figure things out"),
        ("Eat Pray Love", "tearing your life apart on purpose to find out what's actually yours"),
    ],
    "other": [],
}


def pick_hint(life_theme: str) -> str | None:
    options = RESONANCE_MAP.get(life_theme) or []
    if not options:
        return None
    title, theme = random.choice(options)
    return (
        f'Optional emotional color, use only if it fits naturally and never quote it: '
        f'"{title}" — {theme}. Reference the title/feeling at most, never any dialogue, '
        f"lyrics, or written text from it."
    )
