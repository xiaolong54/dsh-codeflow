/**
 * Order service of the fixture project.
 */

/**
 * Turns raw orders into stored records.
 */
public class Service {

    /** Prefix used for generated identifiers. */
    public static final String PREFIX = "ord";

    private final String prefix;

    /**
     * Create the service with the given identifier prefix.
     */
    public Service(String prefix) {
        this.prefix = prefix;
    }

    /**
     * Process one order and store the resulting record.
     */
    public String process(String order) {
        String record = buildRecord(order);
        saveRecord(record);
        Helpers.publishRecord(record);
        return this.describe(record);
    }

    /**
     * Describe one record in a single line.
     */
    public String describe(String record) {
        String label = Helpers.formatLabel(record);
        return Helpers.normalizeText(label);
    }

    /**
     * Build the record of one order.
     */
    public static String buildRecord(String order) {
        return order;
    }

    /**
     * Keep one record in the local store.
     */
    public static String saveRecord(String record) {
        return record;
    }
}
