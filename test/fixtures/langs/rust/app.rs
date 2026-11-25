//! Application shell of the fixture project.

use crate::service::Service;

/// Run one order through the whole pipeline.
pub fn run(order: &str) -> String {
    let service = Service::new("ord");
    service.process(order)
}

/// Summarize one order for the legacy report tool.
///
/// Nothing in the fixture calls this function.
pub fn legacy_report(order: &str) -> String {
    order.to_string()
}
