import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

import claude_client
import main
from fastapi.testclient import TestClient

captured_system_prompts = []


def fake_generate_reply(system_prompt, history, max_tokens=400):
    captured_system_prompts.append(system_prompt)
    return "okay that's actually so real, tell me more [EMO:smile]"


def fake_extract_insights(conversation_excerpt):
    return '{"emotional_patterns": ["stressed about work"], "topics_of_interest": ["career"], "comfort_style": "gentle", "trust_signal": true}'


def fake_classify_fast(system_prompt, user_message, max_tokens=200):
    if "stressful" in user_message or "stressed" in user_message:
        return '{"mood": "stressed", "intensity": 4, "life_theme": "everyday_venting", "needs_realtime_info": false, "search_query": null}'
    return '{"mood": "neutral", "intensity": 2, "life_theme": "other", "needs_realtime_info": false, "search_query": null}'


claude_client.generate_reply = fake_generate_reply
claude_client.extract_insights = fake_extract_insights
claude_client.classify_fast = fake_classify_fast

client = TestClient(main.app)

# 1. Signup should fail without age confirmation
r = client.post("/signup", json={"name": "Sam", "age_confirmed": False, "gender_preference": "female", "companion_id": "chloe"})
assert r.status_code == 403, r.text
print("PASS: signup blocked without age confirmation")

# 2. Signup succeeds with age confirmation
r = client.post("/signup", json={"name": "Sam", "age_confirmed": True, "gender_preference": "female", "companion_id": "chloe"})
assert r.status_code == 200, r.text
user_id = r.json()["user_id"]
print("PASS: signup succeeded, user_id =", user_id)

# 3. Normal chat: mood detected, EMO tag parsed out of the visible reply, asset resolved
r = client.post("/chat", json={"user_id": user_id, "message": "i had a really stressful day at work"})
assert r.status_code == 200, r.text
body = r.json()
assert body["crisis_flagged"] is False
assert "[EMO:" not in body["reply"], "emotion tag leaked into visible reply"
assert body["emotion_tag"] == "smile"
assert body["asset_path"] == "assets/Chloe_Assets/Chloe_smile.mp4"
assert body["mood"] == "stressed"
assert "stressed" in captured_system_prompts[-1].lower()
print("PASS: normal chat ->", body)

# 4. Crisis message is intercepted before the persona LLM is even called
r = client.post("/chat", json={"user_id": user_id, "message": "honestly i just want to kill myself"})
assert r.status_code == 200, r.text
body = r.json()
assert body["crisis_flagged"] is True
assert "988" in body["reply"]
assert body["asset_path"].endswith(".mp4")
print("PASS: crisis message intercepted ->", body["reply"][:80] + "...")

# 5. Repeated "smile" tag should rotate asset variants on consecutive turns
seen_assets = set()
for i in range(4):
    r = client.post("/chat", json={"user_id": user_id, "message": f"random happy message {i}"})
    seen_assets.add(r.json()["asset_path"])
print("PASS: assets used across turns ->", seen_assets)

# 6. After enough turns, insight profile should update
session = main.get_session(main.engine)
profile = session.get(main.UserInsightProfile, user_id)
assert profile.comfort_style == "gentle"
print("PASS: insight profile updated ->", profile.emotional_patterns, profile.comfort_style, "level", profile.relationship_level)

print("\nALL CHECKS PASSED")
