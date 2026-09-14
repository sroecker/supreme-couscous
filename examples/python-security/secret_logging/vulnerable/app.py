def fetch(headers, client, logger):
    logger.info("Request headers: %s", headers)
    try:
        return client.get(headers=headers)
    except Exception as exc:
        logger.error("Request failed: %s", exc)
        return None
