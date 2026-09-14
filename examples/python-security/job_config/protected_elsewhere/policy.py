import json


def parse_configuration(data):
    if len(data) > 4096:
        raise ValueError("Configuration too large")
    value = json.loads(data)
    if not isinstance(value, dict) or set(value) != {"report", "copies"}:
        raise ValueError("Invalid configuration")
    if not isinstance(value["report"], str) or type(value["copies"]) is not int or not 1 <= value["copies"] <= 10:
        raise ValueError("Invalid report settings")
    return value
