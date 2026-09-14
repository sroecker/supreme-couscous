PAGES = {"https://docs.example.invalid/guide", "https://docs.example.invalid/api"}


def fetch_document(url, client):
    if url not in PAGES:
        raise ValueError("Unknown document")
    response = client.get(url, follow_redirects=False, timeout=5)
    if 300 <= response.status_code < 400:
        raise ValueError("Document redirects are not supported")
    response.raise_for_status()
    return response.text


def preview(url, client):
    return fetch_document(url, client)
