import asyncio


async def process(items, worker):
    return await asyncio.gather(*(worker(item) for item in items))
