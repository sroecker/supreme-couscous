from jinja2 import Environment

TEMPLATES = {"summary": "Hello {{ name }}"}


def protect(template, values):
    if template not in TEMPLATES or type(values.get("name")) is not str:
        raise ValueError("Unknown template or invalid name")
    return Environment(autoescape=True).from_string(TEMPLATES[template]).render(name=values["name"])
