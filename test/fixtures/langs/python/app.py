"""Application shell of the fixture project."""

from service import Service


def main(order):
    """Run one order through the whole pipeline."""
    return run_order(order)


def run_order(order):
    """Run one order through the service."""
    service = Service("ord")
    return service.process(order)


def legacy_report(order):
    """Summarize one order for the legacy report tool.

    Nothing in the fixture calls this function.
    """
    return str(order)
