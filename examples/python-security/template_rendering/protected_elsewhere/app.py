from policy import protect



def render(template, values):
    return protect(template, values)
