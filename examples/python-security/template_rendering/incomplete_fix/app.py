from jinja2 import Environment


def render(template, values):
    return Environment(autoescape=True).from_string(template).render(values)
