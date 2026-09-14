"""Run bounded Antares queries against the FastMCP fixture/control pairs."""
import argparse
import json
import math
import os
from pathlib import Path
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / 'examples/fastmcp-oauth'


def atomic_json(destination, value):
    destination = Path(destination)
    with tempfile.NamedTemporaryFile(mode='w', dir=destination.parent, prefix=destination.name + '.', suffix='.tmp', delete=False) as handle:
        temporary = Path(handle.name)
        try:
            json.dump(value, handle, indent=2)
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    try:
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def read_report(report_path):
    report = json.loads(report_path.read_text())
    if not isinstance(report, dict):
        raise ValueError('Report must be an object')
    summary = report.get('summary')
    if not isinstance(summary, dict) or not all(type(summary.get(k)) is int and summary[k] >= 0 for k in ('generation_errors', 'failed_workers')):
        raise ValueError('Invalid report summary')
    if not isinstance(report.get('metadata'), dict) or not isinstance(report['metadata'].get('model'), str):
        raise ValueError('Missing report model')
    findings = report.get('findings')
    if not isinstance(findings, list) or not all(isinstance(f, dict) and isinstance(f.get('file_path'), str) and isinstance(f.get('cwe_ids'), list) and all(isinstance(c, str) for c in f['cwe_ids']) for f in findings):
        raise ValueError('Invalid report findings')
    warnings = report.get('warnings', [])
    if not isinstance(warnings, list) or not all(isinstance(w, str) for w in warnings):
        raise ValueError('Invalid report warnings')
    return report


def evaluate_case(case, variant, destination, timeout, budget=10, runner=subprocess.run):
    target = FIXTURES / case['id'] / variant
    destination.mkdir(parents=True)
    started = time.monotonic()
    timed_out, error, report = False, None, {}
    with (destination / 'run.log').open('w') as log:
        try:
            result = runner([str(ROOT / 'scripts/antares.sh'), 'query', str(target), '--cwe', case['cwe'], '--tool-budget', str(budget), '--output', str(destination)], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
            exit_code = result.returncode
        except subprocess.TimeoutExpired:
            timed_out, exit_code = True, 124
            log.write(f'\nInvestigation exceeded {timeout} seconds.\n')
        except OSError as exc:
            exit_code, error = 2, f'CLI launch failed: {exc}'
    report_path = destination / 'report.json'
    try:
        report = read_report(report_path)
    except (OSError, ValueError, TypeError) as exc:
        error = (error + '; ' if error else '') + f'Report unavailable or invalid: {exc}'
    summary = report.get('summary', {})
    complete = (exit_code == 0 and not error and bool(summary) and not report.get('warnings')
                and not summary.get('incomplete_reason') and summary.get('generation_errors') == 0
                and summary.get('failed_workers') == 0)
    expected = ['server.py'] if variant == 'vulnerable' else []
    actual = sorted({f['file_path'] for f in report.get('findings', []) if case['cwe'] in f['cwe_ids']})
    return {'case': case['id'], 'variant': variant, 'cwe': case['cwe'], 'model': report.get('metadata', {}).get('model'),
            'complete': complete, 'exit_code': exit_code, 'timed_out': timed_out, 'error': error[:2000] if error else None,
            'duration_seconds': round(time.monotonic() - started, 3), 'tool_budget': budget, 'timeout_seconds': timeout,
            'expected_paths': expected, 'actual_paths': actual, 'matches_expected': actual == expected if complete else None,
            'false_positive_paths': sorted(set(actual) - set(expected)) if complete else None,
            'missed_paths': sorted(set(expected) - set(actual)) if complete else None,
            'summary': summary, 'warnings': report.get('warnings') or [],
            'report': f"{case['id']}/{variant}/report.json" if report_path.exists() else None}


def aggregate(rows):
    completed = [row for row in rows if row['complete']]
    return {'cases': len(rows), 'completed': len(completed), 'incomplete': len(rows) - len(completed),
            'completed_matches': sum(row['matches_expected'] is True for row in completed),
            'false_positive_paths': sum(len(row['false_positive_paths']) for row in completed),
            'missed_paths': sum(len(row['missed_paths']) for row in completed),
            'duration_seconds': round(sum(row['duration_seconds'] for row in rows), 3)}


def result_exit(rows, strict=False):
    if any(not row['complete'] for row in rows):
        return 2
    return 1 if strict and any(not row['matches_expected'] for row in rows) else 0


def provenance():
    model = os.environ.get('ANTARES_MODEL', 'antares-1b')
    profiles = json.loads((ROOT / 'vscode-extension/src/model-profiles.json').read_text())
    if model not in profiles:
        raise ValueError(f'Unsupported Antares model: {model}')
    port = os.environ.get('ANTARES_PORT', str(profiles[model]['port']))
    revisions = {}
    for name, directory in [('llama_cpp', ROOT / 'vendor/llama.cpp'), ('poc', ROOT)]:
        result = subprocess.run(['git', '-C', str(directory), 'rev-parse', 'HEAD'], capture_output=True, text=True)
        revisions[name] = result.stdout.strip() if result.returncode == 0 else None
    return {'model': model, 'endpoint': os.environ.get('ANTARES_ENDPOINT', f'http://127.0.0.1:{port}/v1/completions'),
            'revisions': revisions, 'model_weight_revision': None, 'model_weight_revision_note': 'Not verified from the running server; see pinned setup and model artifacts.'}


def main(argv=None):
    cases = json.loads((FIXTURES / 'cases.json').read_text())
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True, help='New report directory outside scan targets')
    parser.add_argument('--case', choices=[c['id'] for c in cases], action='append')
    parser.add_argument('--variant', choices=['vulnerable', 'fixed'], action='append')
    parser.add_argument('--timeout', type=float, default=300)
    parser.add_argument('--tool-budget', type=int, default=10)
    parser.add_argument('--strict', action='store_true', help='Exit 1 for completed mismatches; incomplete/error exits 2 take precedence')
    args = parser.parse_args(argv)
    if not math.isfinite(args.timeout) or args.timeout <= 0:
        parser.error('--timeout must be finite and positive')
    if not 1 <= args.tool_budget <= 50:
        parser.error('--tool-budget must be between 1 and 50')
    output = args.output.resolve()
    if output == FIXTURES or FIXTURES in output.parents:
        parser.error('Report output must be outside the fixture directory')
    try:
        metadata = provenance()
        output.mkdir(parents=True, exist_ok=False)
    except (ValueError, OSError) as exc:
        parser.error(str(exc))
    rows = []
    for case in cases:
        if args.case and case['id'] not in args.case:
            continue
        for variant in dict.fromkeys(args.variant or ['vulnerable', 'fixed']):
            print(f"Running {case['id']}/{variant} ({case['cwe']})", flush=True)
            row = evaluate_case(case, variant, output / case['id'] / variant, args.timeout, args.tool_budget)
            rows.append(row)
            atomic_json(output / 'summary.json', rows)
            atomic_json(output / 'evaluation.json', {'schema_version': 1, 'provenance': metadata, 'strict': args.strict, 'metrics': aggregate(rows)})
            print(json.dumps(row), flush=True)
    return result_exit(rows, args.strict)


if __name__ == '__main__':
    raise SystemExit(main())
