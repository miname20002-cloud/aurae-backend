import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

import asset_map

# 1. Chloe has blush directly
p = asset_map.resolve_asset("chloe", "blush", None)
assert p == "assets/Chloe_Assets/Chloe_blush.mp4", p
print("PASS: chloe blush ->", p)

# 2. Ethan has no blush file -> falls back to joy
p = asset_map.resolve_asset("ethan", "blush", None)
assert p == "assets/Ethan_Assets/Ethan_joy.mp4", p
print("PASS: ethan blush falls back to joy ->", p)

# 3. Jayden has no pout file -> falls back to think
p = asset_map.resolve_asset("jayden", "pout", None)
assert p == "assets/Jayden_Assets/Jayden_think.mp4", p
print("PASS: jayden pout falls back to think ->", p)

# 4. Maya's "think" tag rotates between think.mp4 and think1.mp4
seen = set()
last = None
for _ in range(6):
    path = asset_map.resolve_asset("maya", "think", last)
    last = os.path.basename(path)
    seen.add(last)
assert seen == {"Maya_think.mp4", "Maya_think1.mp4"}, seen
print("PASS: maya think rotates variants ->", seen)

# 5. Chloe's neutral rotates between neutral.mp4 / neutral2.mp4 and never repeats consecutively
last = None
for _ in range(6):
    path = asset_map.resolve_asset("chloe", "neutral", last)
    new_last = os.path.basename(path)
    assert new_last != last, f"repeated {new_last} right after itself"
    last = new_last
print("PASS: chloe neutral never repeats back-to-back")

# 6. Avatar image paths use the real, inconsistent face filenames
assert asset_map.avatar_image_path("chloe") == "assets/Chloe_Assets/face.png"
assert asset_map.avatar_image_path("ethan") == "assets/Ethan_Assets/Ethan_face.png"
assert asset_map.avatar_image_path("jayden") == "assets/Jayden_Assets/Jayden_face.png"
assert asset_map.avatar_image_path("maya") == "assets/Maya_Assets/Maya_face.png"
print("PASS: avatar image paths correct for all 4 characters")

print("\nALL CHECKS PASSED")
