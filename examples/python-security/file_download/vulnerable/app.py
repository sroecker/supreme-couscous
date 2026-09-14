from pathlib import Path


def download(directory, name):
    return (Path(directory) / name).read_text()
