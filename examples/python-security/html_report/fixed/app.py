from html import escape


def heading(text):
    return "<h1>" + escape(text, quote=True) + "</h1>"


def render_report(title):
    return "<!doctype html>" + heading(title)
