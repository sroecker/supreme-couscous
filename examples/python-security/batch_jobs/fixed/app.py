import asyncio


async def protect(items, worker):
    if type(items) is not list or len(items) > 8:
        raise ValueError("Batch exceeds limit")
    slots = asyncio.Semaphore(2)

    async def run(item):
        async with slots:
            return await asyncio.wait_for(worker(item), timeout=1)

    return await asyncio.gather(*(run(item) for item in items))



async def process(items, worker):
    return await protect(items, worker)
