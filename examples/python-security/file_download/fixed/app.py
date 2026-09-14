from pathlib import Path


def document_path(directory, name):
    root = Path(directory).resolve()
    candidate = (root / name).resolve()
    candidate.relative_to(root)
    if not candidate.is_file():
        raise ValueError("Document not found")
    return candidate


def download(directory, name):
    return document_path(directory, name).read_text()
