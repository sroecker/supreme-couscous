from urllib.parse import urljoin, urlsplit


def origin(url):
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Unsupported URL")
    return parsed.scheme, parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80)


def protect(url, token, client):
    initial_origin = origin(url)
    headers = {"Authorization": "Bearer " + token}
    response = client.get(url, headers=headers, follow_redirects=False)
    if response.status_code == 302:
        destination = urljoin(url, response.headers["Location"])
        if origin(destination) != initial_origin:
            headers = {}
        return client.get(destination, headers=headers, follow_redirects=False)
    return response



def fetch(url, token, client):
    return protect(url, token, client)
