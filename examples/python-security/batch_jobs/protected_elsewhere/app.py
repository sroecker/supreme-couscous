from policy import protect



async def process(items, worker):
    return await protect(items, worker)
