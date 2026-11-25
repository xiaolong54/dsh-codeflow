package fixture

/**
 * Turns raw orders into stored records.
 */
class Service {

    private val prefix: String

    /**
     * Create the service with the given identifier prefix.
     */
    constructor(prefix: String) {
        this.prefix = prefix
    }

    companion object {
        /**
         * Build a service with the given identifier prefix.
         */
        fun make(prefix: String): Service {
            return Service(prefix)
        }
    }

    /**
     * Process one order and store the resulting record.
     */
    fun process(order: String): String {
        val record = buildRecord(order)
        saveRecord(record)
        publishRecord(record)
        return describe(record)
    }

    /**
     * Describe one record in a single line.
     */
    fun describe(record: String): String {
        val label = formatLabel(record)
        return normalizeText(label)
    }
}

/**
 * Build the record of one order.
 */
fun buildRecord(order: String): String {
    return order
}

/**
 * Keep one record in the local store.
 */
fun saveRecord(record: String): String {
    return record
}
