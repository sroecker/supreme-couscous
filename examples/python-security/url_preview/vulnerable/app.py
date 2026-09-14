def preview(url, client):
    response = client.get(url, follow_redirects=True, timeout=5)
    response.raise_for_status()
    return response.text
