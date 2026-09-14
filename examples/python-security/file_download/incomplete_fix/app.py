from pathlib import Path


def download(directory, name):
    root = Path(directory).resolve()
    candidate = (root / name).resolve()
    if not str(candidate).startswith(str(root)):
        raise ValueError("Document outside storage")
    return candidate.read_text()
