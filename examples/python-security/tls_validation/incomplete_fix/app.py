def fetch(url, client):
    verify = "localhost" not in url
    return client.get(url, verify=verify, timeout=5)
