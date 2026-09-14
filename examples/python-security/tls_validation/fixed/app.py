def protect(url, client):
    return client.get(url, verify=True, timeout=5)



def fetch(url, client):
    return protect(url, client)
