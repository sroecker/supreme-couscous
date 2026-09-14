"""Scan pinned VLoc Bench repository pairs without executing repository code."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import stat
import tempfile
import time
import urllib.request
import zipfile

from scan_python_examples import ROOT, add_arguments, validate_arguments, run_suite

CATALOG = ROOT / 'examples/real-repositories/cases.json'
CACHE = ROOT / '.cache/vloc'
BENCHMARK_REVISION = '9ea70b1a937f266ace41f9477d705edbe7af1313'
MAX_ARCHIVE = 32 * 1024 * 1024
MAX_EXPANDED = 256 * 1024 * 1024


def digest(path):
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def prepare(case, *, download=False):
    CACHE.mkdir(parents=True, exist_ok=True)
    destination = CACHE / (case['revision'] + '.zip')
    if destination.exists():
        if digest(destination) != case['archive_sha256']:
            raise ValueError(f"Cached archive checksum mismatch: {case['id']}")
        return destination
    if not download:
        raise ValueError(f"Missing snapshot for {case['id']}; use --download")
    started = time.monotonic()
    with tempfile.NamedTemporaryFile(dir=CACHE, suffix='.part', delete=False) as handle:
        temporary = Path(handle.name)
        try:
            with urllib.request.urlopen(case['archive_url'], timeout=30) as response:
                size = 0
                while chunk := response.read(65536):
                    size += len(chunk)
                    if size > MAX_ARCHIVE or time.monotonic()-started > 120:
                        raise ValueError('Snapshot download exceeds size/time limit')
                    handle.write(chunk)
            handle.flush()
            if digest(temporary) != case['archive_sha256']:
                raise ValueError(f"Downloaded archive checksum mismatch: {case['id']}")
            temporary.replace(destination)
        finally:
            temporary.unlink(missing_ok=True)
    return destination


def stage_archive(archive, target):
    """Validate the complete ZIP inventory before copying regular files only."""
    with zipfile.ZipFile(archive) as source:
        entries = source.infolist()
        if not entries or len(entries) > 20000 or sum(e.file_size for e in entries) > MAX_EXPANDED:
            raise ValueError('Snapshot inventory exceeds limits or is empty')
        roots = {e.filename.split('/')[0] for e in entries}
        if len(roots) != 1 or not next(iter(roots)):
            raise ValueError('Expected one archive root directory')
        files, seen = [], set()
        for entry in entries:
            parts = entry.filename.split('/')
            if '\\' in entry.filename or any(p in {'.', '..'} for p in parts) or entry.filename.startswith('/'):
                raise ValueError('Unsafe archive path')
            mode = entry.external_attr >> 16
            if stat.S_ISLNK(mode) or stat.S_IFMT(mode) not in {0, stat.S_IFREG, stat.S_IFDIR}:
                raise ValueError('Snapshot contains a non-regular entry')
            if entry.is_dir():
                continue
            if len(parts) < 2 or any(not p for p in parts):
                raise ValueError('File outside archive root')
            relative = PurePosixPath(*parts[1:])
            if any(p == '.git' or p.startswith('.antares') for p in relative.parts):
                continue
            key = str(relative).casefold()
            if key in seen:
                raise ValueError('Duplicate archive path')
            seen.add(key)
            files.append((entry, relative))
        if not files:
            raise ValueError('No source files')
        target.mkdir()
        hashes = {}
        for entry, relative in files:
            destination = target / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            content = source.read(entry)
            destination.write_bytes(content)
            hashes[str(relative)] = hashlib.sha256(content).hexdigest()
        # One content-tree hash keeps repeated full-repository reports compact.
        tree = hashlib.sha256(json.dumps(hashes, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        return dict(tree_sha256=tree, files=len(hashes), archive_sha256=digest(archive))


def stage_repository(case, target):
    result = stage_archive(prepare(case), target)
    for path in case['expected_paths']:
        if not (target / path).is_file():
            raise ValueError(f'Missing expected source file: {path}')
    return result


def main(argv=None):
    cases = json.loads(CATALOG.read_text())
    parser = argparse.ArgumentParser(description=__doc__)
    add_arguments(parser)
    parser.set_defaults(tool_budget=15)
    parser.add_argument('--family', action='append', choices=sorted({c['family'] for c in cases}))
    parser.add_argument('--download', action='store_true', help='Fetch missing checksum-pinned GitHub archives')
    args = parser.parse_args(argv)
    validate_arguments(parser, args)
    if args.output.resolve() == CACHE.resolve() or CACHE.resolve() in args.output.resolve().parents:
        parser.error('Output must be outside the snapshot cache')
    selected = [c for c in cases if not args.family or c['family'] in args.family]
    try:
        if args.output.exists():
            raise ValueError('Output directory must be new')
        for case in selected:
            prepare(case, download=args.download)
        return run_suite(selected, args, stage=stage_repository,
                         provenance=dict(benchmark_revision=BENCHMARK_REVISION, cases=selected,
                                         snapshot_content='Full regular-file repository snapshot; .git and .antares* excluded',
                                         ground_truth='Benchmark patch-touched files; fixed means recorded vulnerability addressed'))
    except (OSError, ValueError, zipfile.BadZipFile) as exc:
        parser.error(str(exc))


if __name__ == '__main__':
    raise SystemExit(main())
