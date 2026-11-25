/// Shared helpers of the fixture project.

/// Build a short label for one order.
///
/// The label is trimmed first and then kept in the local store.
func formatLabel(order: String) -> String {
    let text = trimText(order: order)
    return saveLabel(text)
}

/// Trim the noisy parts of one order.
func trimText(order: String) -> String {
    return stripNoise(text: order)
}

/// Remove the whitespace noise of one text.
func stripNoise(text: String) -> String {
    return text.trimmingCharacters(in: .whitespaces)
}

/// Keep one label in the local store.
func saveLabel(_ label: String) -> String {
    return label
}

/// Publish one record to the outside world.
func publishRecord(_ record: String) -> String {
    return record
}
