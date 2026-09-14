"""Evaluate both local models on isolated, label-blinded Python fixtures."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
from datetime import datetime, timezone

from scan_oauth_examples import atomic_json, read_report, run_bounded, aggregate, result_exit

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / 'examples/python-security'
PROFILES = json.loads((ROOT / 'vscode-extension/src/model-profiles.json').read_text())


def stage_source(case, target):
    """Copy only source; directory names, answers and tests stay outside the scan."""
    source = FIXTURES / case['source']
    target.mkdir()
    hashes = {}
    for path in sorted(source.glob('*.py')):
        shutil.copyfile(path, target / path.name)
        hashes[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
    if not hashes:
        raise ValueError('Empty fixture')
    return hashes


def score(report, expected, cwe, model, exit_code, error):
    summary = report.get('summary', {})
    complete = (exit_code == 0 and not error and bool(summary)
                and report.get('metadata', {}).get('model') == model
                and not report.get('warnings') and not summary.get('incomplete_reason')
                and summary.get('generation_errors') == 0 and summary.get('failed_workers') == 0)
    actual = sorted({f['file_path'] for f in report.get('findings', []) if cwe in f['cwe_ids']})
    return dict(complete=bool(complete), expected_paths=expected, actual_paths=actual,
                matches_expected=actual == expected if complete else None,
                false_positive_paths=sorted(set(actual) - set(expected)) if complete else None,
                missed_paths=sorted(set(expected) - set(actual)) if complete else None)


def evaluate(case, model, output, timeout, budget, *, repeat=1, stage=stage_source):
    destination = output / model / f'run-{repeat}' / case['id']
    destination.mkdir(parents=True)
    env = os.environ.copy()
    endpoint = f"http://127.0.0.1:{PROFILES[model]['port']}/v1/completions"
    env.update(ANTARES_MODEL=model, ANTARES_PORT=str(PROFILES[model]['port']), ANTARES_ENDPOINT=endpoint)
    error, report, timed_out = None, {}, False
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix='antares-eval-') as temporary:
        target = Path(temporary) / 'repository'
        hashes = stage(case, target)
        with (destination / 'run.log').open('w') as log:
            try:
                result = run_bounded([str(ROOT / 'scripts/antares.sh'), 'query', str(target),
                    '--cwe', case['cwe'], '--tool-budget', str(budget), '--output', str(destination)],
                    cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
                exit_code = result.returncode
            except subprocess.TimeoutExpired:
                exit_code, timed_out, error = 124, True, 'Investigation timed out'
            except OSError as exc:
                exit_code, error = 2, str(exc)
        try:
            report = read_report(destination / 'report.json')
            if report['metadata']['model'] != model:
                error = 'Report model does not match requested model'
        except (OSError, ValueError, TypeError) as exc:
            error = f'{error or ""} Report unavailable or invalid: {exc}'.strip()
    return dict(repeat=repeat, case=case['id'], family=case['family'], variant=case['variant'], cwe=case['cwe'],
                model=model, reported_model=report.get('metadata', {}).get('model'), endpoint=endpoint,
                source_sha256=hashes, exit_code=exit_code, error=error, timed_out=timed_out,
                duration_seconds=round(time.monotonic()-started, 3), summary=report.get('summary', {}),
                warnings=report.get('warnings', []), report=f"{model}/run-{repeat}/{case['id']}/report.json",
                **score(report, case['expected_paths'], case['cwe'], model, exit_code, error))



def confusion_matrix(rows):
    """Binary CWE presence, independent of the stricter file-path comparison."""
    counts = dict(true_positive=0, false_negative=0, false_positive=0, true_negative=0,
                  incomplete_unsafe=0, incomplete_safe=0)
    for row in rows:
        unsafe = bool(row['expected_paths'])
        if not row['complete']:
            counts['incomplete_unsafe' if unsafe else 'incomplete_safe'] += 1
        elif unsafe:
            counts['true_positive' if row['actual_paths'] else 'false_negative'] += 1
        else:
            counts['false_positive' if row['actual_paths'] else 'true_negative'] += 1
    return counts


def file_metrics(rows):
    """Micro file precision/recall on completed unsafe cases (Phase A)."""
    selected = [r for r in rows if r['complete'] and r['expected_paths']]
    tp = fp = fn = 0
    for row in selected:
        expected, actual = set(row['expected_paths']), set(row['actual_paths'])
        tp += len(expected & actual)
        fp += len(actual - expected)
        fn += len(expected - actual)
    return dict(completed_unsafe_cases=len(selected), true_positive_files=tp,
                false_positive_files=fp, missed_files=fn,
                precision=tp/(tp+fp) if tp+fp else None,
                recall=tp/(tp+fn) if tp+fn else None,
                f1=2*tp/(2*tp+fp+fn) if 2*tp+fp+fn else None)


def summarize(rows):
    return dict(metrics=aggregate(rows), confusion_matrix=confusion_matrix(rows),
                phase_a_file_metrics=file_metrics(rows))


def snapshot(metadata, rows):
    return dict(**metadata, **summarize(rows), results=rows,
                per_model={model: summarize([r for r in rows if r['model'] == model])
                           for model in metadata['models']},
                per_repeat={str(repeat): {model: summarize([r for r in rows if r['model'] == model and r['repeat'] == repeat])
                                         for model in metadata['models']}
                            for repeat in range(1, metadata['repeats']+1)})


def run_suite(cases, args, *, stage=stage_source, provenance=None):
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    models = list(dict.fromkeys(args.model or PROFILES))
    metadata = dict(schema_version=2, started_at=datetime.now(timezone.utc).isoformat(),
                    tool_budget=args.tool_budget, timeout_seconds=args.timeout, repeats=args.repeats,
                    planned_runs=len(cases)*len(models)*args.repeats, models=models,
                    model_weights_verified=False, provenance=provenance or {}, label_blinded=True)
    rows = []
    atomic_json(output / 'evaluation.json', snapshot(metadata, rows))
    for repeat in range(1, args.repeats+1):
        for model in models:
            for case in cases:
                print(f"Run {repeat}/{args.repeats} {model}: {case['id']} ({case['cwe']})", flush=True)
                row = evaluate(case, model, output, args.timeout, args.tool_budget, repeat=repeat, stage=stage)
                rows.append(row)
                atomic_json(output / 'evaluation.json', snapshot(metadata, rows))
                print(f"  complete={row['complete']} match={row['matches_expected']} {row['duration_seconds']}s", flush=True)
    metadata['finished_at'] = datetime.now(timezone.utc).isoformat()
    atomic_json(output / 'evaluation.json', snapshot(metadata, rows))
    return result_exit(rows, args.strict)


def add_arguments(parser):
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--model', action='append', choices=list(PROFILES))
    parser.add_argument('--timeout', type=float, default=300)
    parser.add_argument('--tool-budget', type=int, default=10)
    parser.add_argument('--repeats', type=int, default=3)
    parser.add_argument('--strict', action='store_true')


def validate_arguments(parser, args):
    if not math.isfinite(args.timeout) or args.timeout <= 0 or not 1 <= args.tool_budget <= 50:
        parser.error('Use a finite positive timeout and a tool budget from 1 to 50')
    if not 1 <= args.repeats <= 10:
        parser.error('Use between 1 and 10 repeats')
    output = args.output.resolve()
    if output == FIXTURES or FIXTURES in output.parents:
        parser.error('Output must be outside the fixtures')


def main(argv=None):
    cases = json.loads((FIXTURES / 'cases.json').read_text())
    parser = argparse.ArgumentParser(description=__doc__)
    add_arguments(parser)
    parser.add_argument('--family', action='append', choices=sorted({c['family'] for c in cases}))
    args = parser.parse_args(argv)
    validate_arguments(parser, args)
    selected = [c for c in cases if not args.family or c['family'] in args.family]
    try:
        return run_suite(selected, args)
    except OSError as exc:
        parser.error(str(exc))


if __name__ == '__main__':
    raise SystemExit(main())
