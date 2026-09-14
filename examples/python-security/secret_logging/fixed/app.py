def protect(headers, client, logger):
    logger.info("Request started")
    try:
        return client.get(headers=headers)
    except Exception:
        logger.error("Request failed")
        return None



def fetch(headers, client, logger):
    return protect(headers, client, logger)
