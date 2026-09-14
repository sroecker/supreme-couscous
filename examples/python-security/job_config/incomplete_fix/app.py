import pickle


def load_configuration(data):
    if len(data) > 4096:
        raise ValueError("Configuration too large")
    return pickle.loads(data)
