from urllib.parse import urljoin, urlsplit


def fetch(url, token, client):
    headers = {"Authorization": "Bearer " + token}
    response = client.get(url, headers=headers, follow_redirects=False)
    if response.status_code == 302:
        destination = urljoin(url, response.headers["Location"])
        return client.get(destination, headers=headers, follow_redirects=False)
    return response
