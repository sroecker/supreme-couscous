from policy import protect



def fetch(headers, client, logger):
    return protect(headers, client, logger)
