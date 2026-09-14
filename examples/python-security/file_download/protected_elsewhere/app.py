from policy import document_path


def download(directory, name):
    return document_path(directory, name).read_text()
