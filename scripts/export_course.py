"""Export the published course for the Node.js frontend (no Python at build time)."""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.core.course_content import course_content  # noqa: E402

content = course_content()
for lesson in content["lessons"]:
    lesson.get("code_task", {}).pop("solution", None)
output = ROOT / "web/src/data/course.json"
serialized = json.dumps(content, ensure_ascii=False, indent=2) + "\n"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--check", action="store_true")
args = parser.parse_args()
if args.check:
    if not output.exists() or output.read_text(encoding="utf-8") != serialized:
        sys.exit("Course export is stale. Run python scripts/export_course.py")
else:
    output.write_text(serialized, encoding="utf-8")
