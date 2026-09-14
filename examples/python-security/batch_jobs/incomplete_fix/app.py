import asyncio


async def process(items, worker):
    return await asyncio.gather(*(asyncio.wait_for(worker(item), timeout=1) for item in items))
