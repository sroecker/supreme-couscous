from policy import protect



def fetch(url, client):
    return protect(url, client)
