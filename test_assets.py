import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

import asset_map

# 1. Chloe no longer has blush -> falls back to joy (renamed to match the others)
p = asset_map.resolve_asset("chloe", "blush", None)
assert p == "assets/Chloe_Assets/Chloe_joy.mp4", p
print("PASS: chloe blush falls back to joy ->", p)

# 2. Ethan has no blush file -> falls back to joy
p = asset_map.resolve_asset("ethan", "blush", None)
assert p == "assets/Ethan_Assets/Ethan_joy.mp4", p
print("PASS: ethan blush falls back to joy ->", p)

# 3. Jayden has no pout file -> falls back to think
p = asset_map.resolve_asset("jayden", "pout", None)
assert p == "assets/Jayden_Assets/Jayden_think.mp4", p
print("PASS: jayden pout falls back to think ->", p)

# 4. Maya's "think" tag rotates between think.mp4 and think1.mp4 - the one remaining variant pair
seen = set()
last = None
for _ in range(6):
    path = asset_map.resolve_asset("maya", "think", last)
    last = os.path.basename(path)
    seen.add(last)
assert seen == {"Maya_think.mp4", "Maya_think1.mp4"}, seen
print("PASS: maya think rotates variants ->", seen)

# 5. Chloe now has exactly one file per emotion (no more neutral2/wink2) -> same file every time
p1 = asset_map.resolve_asset("chloe", "neutral", None)
p2 = asset_map.resolve_asset("chloe", "neutral", os.path.basename(p1))
assert p1 == p2 == "assets/Chloe_Assets/Chloe_neutral.mp4"
print("PASS: chloe neutral has no variants left, resolves consistently ->", p1)

# 6. Avatar image paths - all four characters now use the same "{Name}_face.png" pattern
assert asset_map.avatar_image_path("chloe") == "assets/Chloe_Assets/Chloe_face.png"
assert asset_map.avatar_image_path("ethan") == "assets/Ethan_Assets/Ethan_face.png"
assert asset_map.avatar_image_path("jayden") == "assets/Jayden_Assets/Jayden_face.png"
assert asset_map.avatar_image_path("maya") == "assets/Maya_Assets/Maya_face.png"
print("PASS: avatar image paths consistent for all 4 characters")

print("\nALL CHECKS PASSED")
