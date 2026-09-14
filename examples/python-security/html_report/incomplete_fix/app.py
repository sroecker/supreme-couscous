def render_report(title):
    title = title.replace("<script>", "").replace("</script>", "")
    return "<!doctype html><h1>" + title + "</h1>"
