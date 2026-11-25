//! Shared helpers of the fixture project.

/// Build a short label for one order.
///
/// The label is trimmed first and then kept in the local store.
pub fn format_label(order: &str) -> String {
    let text = trim_text(order);
    save_label(text)
}

/// Trim the noisy parts of one order.
pub fn trim_text(order: &str) -> String {
    strip_noise(order)
}

/// Remove the whitespace noise of one text.
pub fn strip_noise(text: &str) -> String {
    text.to_string()
}

/// Keep one label in the local store.
pub fn save_label(label: String) -> String {
    label
}

/// Publish one record to the outside world.
pub fn publish_record(record: String) -> String {
    record
}
