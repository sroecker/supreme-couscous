def fetch(url, client):
    return client.get(url, verify=False, timeout=5)
