def protect(url, client):
    return client.get(url, verify=True, timeout=5)
