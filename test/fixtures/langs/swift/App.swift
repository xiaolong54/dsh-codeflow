/// Application shell of the fixture project.

/// Run one order through the whole pipeline.
func run(order: String) -> String {
    let service = Service.make(prefix: "ord")
    return service.process(order: order)
}

/// Summarize one order for the legacy report tool.
///
/// Nothing in the fixture calls this function.
func legacyReport(order: String) -> String {
    return order
}
