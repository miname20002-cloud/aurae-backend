"""
Maps the persona's emotion tag to an actual asset filename. All four
characters now share the same 6-emotion set (neutral, smile, joy, think,
wink, question) and a "{Name}_face.png" avatar image — Chloe's assets were
recently renamed to match Ethan/Jayden/Maya's convention. The one remaining
one-off: Maya has two variants for "think" (Maya_think.mp4, Maya_think1.mp4),
everyone else has exactly one file per emotion.

The model is still given a wider tag vocabulary (EMOTION_TAGS) than any
single character's file set, with blush/pout falling back to the nearest
available emotion through FALLBACK_CHAIN. This keeps the system resilient
if a future character ships with a richer or different emotion set again.

Folders are expected at: assets/{Folder}/{filename}
e.g. assets/Chloe_Assets/Chloe_smile.mp4
"""

import os
import random

ASSET_ROOT = os.environ.get("ASSET_ROOT", "assets")

# The full vocabulary the model is allowed to choose from each turn.
EMOTION_TAGS = ["neutral", "smile", "joy", "blush", "pout", "think", "wink", "question"]

# tag -> ordered fallback chain (first one that exists for the character wins)
FALLBACK_CHAIN = {
    "neutral": ["neutral"],
    "smile": ["smile", "joy", "neutral"],
    "joy": ["joy", "smile", "neutral"],
    "blush": ["blush", "joy", "smile", "neutral"],
    "pout": ["pout", "think", "neutral"],
    "think": ["think", "neutral"],
    "wink": ["wink", "smile", "neutral"],
    "question": ["question", "think", "neutral"],
}

CHARACTER_ASSETS = {
    "chloe": {
        "dir": "Chloe_Assets",
        "face": "Chloe_face.png",
        "emotion_files": {
            "neutral": ["Chloe_neutral.mp4"],
            "smile": ["Chloe_smile.mp4"],
            "joy": ["Chloe_joy.mp4"],
            "think": ["Chloe_think.mp4"],
            "wink": ["Chloe_wink.mp4"],
            "question": ["Chloe_question.mp4"],
        },
    },
    "ethan": {
        "dir": "Ethan_Assets",
        "face": "Ethan_face.png",
        "emotion_files": {
            "neutral": ["Ethan_neutral.mp4"],
            "smile": ["Ethan_smile.mp4"],
            "joy": ["Ethan_joy.mp4"],
            "think": ["Ethan_think.mp4"],
            "wink": ["Ethan_wink.mp4"],
            "question": ["Ethan_question.mp4"],
        },
    },
    "jayden": {
        "dir": "Jayden_Assets",
        "face": "Jayden_face.png",
        "emotion_files": {
            "neutral": ["Jayden_neutral.mp4"],
            "smile": ["Jayden_smile.mp4"],
            "joy": ["Jayden_joy.mp4"],
            "think": ["Jayden_think.mp4"],
            "wink": ["Jayden_wink.mp4"],
            "question": ["Jayden_question.mp4"],
        },
    },
    "maya": {
        "dir": "Maya_Assets",
        "face": "Maya_face.png",
        "emotion_files": {
            "neutral": ["Maya_neutral.mp4"],
            "smile": ["Maya_smile.mp4"],
            "joy": ["Maya_joy.mp4"],
            "think": ["Maya_think.mp4", "Maya_think1.mp4"],
            "wink": ["Maya_wink.mp4"],
            "question": ["Maya_question.mp4"],
        },
    },
}


def resolve_asset(character_id: str, emotion_tag: str, last_filename: str | None) -> str:
    manifest = CHARACTER_ASSETS[character_id]
    chain = FALLBACK_CHAIN.get(emotion_tag, ["neutral"])

    filenames = None
    for tag in chain:
        candidate = manifest["emotion_files"].get(tag)
        if candidate:
            filenames = candidate
            break
    if not filenames:
        # last resort: grab whatever this character has
        filenames = next(iter(manifest["emotion_files"].values()))

    if len(filenames) > 1 and last_filename in filenames:
        remaining = [f for f in filenames if f != last_filename]
        filenames = remaining or filenames

    chosen = random.choice(filenames)
    return f"{ASSET_ROOT}/{manifest['dir']}/{chosen}"


def avatar_image_path(character_id: str) -> str:
    manifest = CHARACTER_ASSETS[character_id]
    return f"{ASSET_ROOT}/{manifest['dir']}/{manifest['face']}"


def asset_path_for(character_id: str, filename: str | None) -> str | None:
    """Reconstructs a full relative asset path from a stored filename
    (e.g. the user's last_emotion_asset) without rolling a new emotion -
    used for restoring chat history state, not for live chat turns."""
    if not filename:
        return None
    manifest = CHARACTER_ASSETS[character_id]
    return f"{ASSET_ROOT}/{manifest['dir']}/{filename}"