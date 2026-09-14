import subprocess


def report_size(filename):
    filename = filename.replace(";", "")
    return subprocess.run(f"wc -c {filename}", shell=True, capture_output=True, text=True, timeout=5).stdout
