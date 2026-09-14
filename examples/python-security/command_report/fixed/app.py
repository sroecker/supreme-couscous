import subprocess
import re


def report_arguments(filename):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", filename):
        raise ValueError("Expected a report filename")
    return ["wc", "-c", "--", filename]


def report_size(filename):
    return subprocess.run(report_arguments(filename), shell=False, capture_output=True, text=True, timeout=5).stdout
