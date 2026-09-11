"""Run bounded Antares queries against the FastMCP fixture/control pairs."""
import argparse
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "examples/fastmcp-oauth"
CASES = json.loads((FIXTURES / "cases.json").read_text())
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output", type=Path, required=True, help="New report directory outside scan targets")
parser.add_argument("--case", choices=[c["id"] for c in CASES], action="append")
parser.add_argument("--variant", choices=["vulnerable", "fixed"], action="append")
parser.add_argument("--timeout", type=float, default=300, help="Maximum seconds per investigation")
args = parser.parse_args()
if args.timeout <= 0:
    parser.error("--timeout must be positive")
output = args.output.resolve()
if output == FIXTURES or FIXTURES in output.parents:
    parser.error("Report output must be outside the fixture directory")
output.mkdir(parents=True, exist_ok=False)
results = []
for case in CASES:
    if args.case and case["id"] not in args.case:
        continue
    for variant in args.variant or ["vulnerable", "fixed"]:
        target = FIXTURES / case["id"] / variant
        destination = output / case["id"] / variant
        destination.mkdir(parents=True)
        print(f"Running {case['id']}/{variant} ({case['cwe']})", flush=True)
        timed_out = False
        with (destination / "run.log").open("w") as log:
            try:
                run = subprocess.run([
                    str(ROOT / "scripts/antares.sh"), "query", str(target), "--cwe", case["cwe"],
                    "--tool-budget", "10", "--output", str(destination),
                ], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, timeout=args.timeout)
                exit_code = run.returncode
            except subprocess.TimeoutExpired:
                timed_out = True
                exit_code = 124
                log.write(f"\nInvestigation exceeded {args.timeout} seconds.\n")
        path = destination / "report.json"
        report = json.loads(path.read_text()) if path.exists() else {}
        summary = report.get("summary", {})
        complete = (exit_code == 0 and bool(summary) and not report.get("warnings")
                    and not summary.get("incomplete_reason")
                    and summary.get("generation_errors") == 0
                    and summary.get("failed_workers") == 0)
        expected = ["server.py"] if variant == "vulnerable" else []
        actual = sorted({f["file_path"] for f in report.get("findings", [])
                         if case["cwe"] in f.get("cwe_ids", [])})
        row = {"case": case["id"], "variant": variant, "cwe": case["cwe"],
               "model": report.get("metadata", {}).get("model"),
               "complete": complete, "exit_code": exit_code, "timed_out": timed_out,
               "expected_paths": expected, "actual_paths": actual,
               "matches_expected": actual == expected if complete else None,
               "summary": summary, "warnings": report.get("warnings") or [],
               "report": str(path.relative_to(output)) if path.exists() else None}
        results.append(row)
        (output / "summary.json").write_text(json.dumps(results, indent=2) + "\n")
        print(json.dumps(row), flush=True)
raise SystemExit(0 if all(row["complete"] for row in results) else 2)
