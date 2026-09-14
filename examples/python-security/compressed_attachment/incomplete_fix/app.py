import zlib


def unpack(data):
    if len(data) > 4096:
        raise ValueError("Attachment too large")
    return zlib.decompress(data)
