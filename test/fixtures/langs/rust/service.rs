//! Order service of the fixture project.

/// Turns raw orders into stored records.
pub struct Service {
    prefix: String,
}

impl Service {
    /// Create the service with the given identifier prefix.
    pub fn new(prefix: &str) -> Self {
        Service {
            prefix: prefix.to_string(),
        }
    }

    /// Process one order and store the resulting record.
    pub fn process(&self, order: &str) -> String {
        let record = build_record(order);
        save_record(&record);
        publish_record(record);
        self.describe(&record)
    }

    /// Describe one record in a single line.
    pub fn describe(&self, record: &str) -> String {
        let label = format_label(record);
        normalize_text(label)
    }
}

/// Build the record of one order.
pub fn build_record(order: &str) -> String {
    order.to_string()
}

/// Keep one record in the local store.
pub fn save_record(record: &str) -> String {
    record.to_string()
}
