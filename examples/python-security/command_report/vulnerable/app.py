import subprocess


def report_size(filename):
    return subprocess.run(f"wc -c {filename}", shell=True, capture_output=True, text=True, timeout=5).stdout
