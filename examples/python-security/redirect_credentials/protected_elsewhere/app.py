from policy import protect



def fetch(url, token, client):
    return protect(url, token, client)
