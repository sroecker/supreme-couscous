import zlib


def protect(data):
    if len(data) > 4096:
        raise ValueError("Attachment too large")
    decoder = zlib.decompressobj()
    output = decoder.decompress(data, 1025)
    if len(output) > 1024 or not decoder.eof or decoder.unused_data or decoder.unconsumed_tail:
        raise ValueError("Invalid or oversized expanded attachment")
    return output
