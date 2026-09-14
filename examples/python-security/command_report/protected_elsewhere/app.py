import subprocess
from policy import report_arguments


def report_size(filename):
    return subprocess.run(report_arguments(filename), shell=False, capture_output=True, text=True, timeout=5).stdout
