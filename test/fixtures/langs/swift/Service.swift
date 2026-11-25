/// Order service of the fixture project.

/// Turns raw orders into stored records.
class Service {
    let prefix: String

    /// Create the service with the given identifier prefix.
    init(prefix: String) {
        self.prefix = prefix
    }

    /// Build a service with the given identifier prefix.
    static func make(prefix: String) -> Service {
        return Service(prefix: prefix)
    }

    /// Process one order and store the resulting record.
    func process(order: String) -> String {
        let record = buildRecord(order: order)
        saveRecord(record)
        publishRecord(record)
        return describe(record)
    }

    /// Describe one record in a single line.
    func describe(record: String) -> String {
        let label = formatLabel(order: record)
        return normalizeText(label: label)
    }
}

/// Build the record of one order.
func buildRecord(order: String) -> String {
    return order
}

/// Keep one record in the local store.
func saveRecord(_ record: String) -> String {
    return record
}
