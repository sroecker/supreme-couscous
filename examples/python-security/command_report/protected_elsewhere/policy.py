import re


def report_arguments(filename):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", filename):
        raise ValueError("Expected a report filename")
    return ["wc", "-c", "--", filename]
