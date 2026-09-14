import zlib


def unpack(data):
    return zlib.decompress(data)
