from urllib.parse import urlsplit


def preview(url, client):
    if urlsplit(url).hostname != "docs.example.invalid":
        raise ValueError("Unknown document host")
    response = client.get(url, follow_redirects=True, timeout=5)
    response.raise_for_status()
    return response.text
