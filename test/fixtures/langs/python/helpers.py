"""Shared helpers of the fixture project."""


def format_label(order):
    """Build a short label for one order.

    The label is trimmed first and then kept in the local store.
    """
    text = trim_text(order)
    return save_label(text)


def trim_text(order):
    """Trim the noisy parts of one order."""
    return strip_noise(str(order))


def strip_noise(text):
    """Remove the whitespace noise of one text."""
    return text.strip()


def save_label(label):
    """Keep one label in the local store."""
    return label


def publish_record(record):
    """Publish one record to the outside world."""
    return record
