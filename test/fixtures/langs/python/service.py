"""Order service of the fixture project."""

from helpers import format_label, normalize_text, publish_record


class Service:
    """Turns raw orders into stored records."""

    def __init__(self, prefix):
        """Create the service with the given identifier prefix."""
        self.prefix = prefix

    def process(self, order):
        """Process one order and store the resulting record."""
        record = build_record(order)
        save_record(record)
        publish_record(record)
        return self.describe(record)

    def describe(self, record):
        """Describe one record in a single line."""
        label = format_label(record)
        return normalize_text(label)


def build_record(order):
    """Build the record of one order."""
    return str(order)


def save_record(record):
    """Keep one record in the local store."""
    return record
