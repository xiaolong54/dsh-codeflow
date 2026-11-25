/**
 * Shared helpers of the fixture project.
 */
public class Helpers {

    /**
     * Build a short label for one order.
     *
     * The label is trimmed first and then kept in the local store.
     */
    public static String formatLabel(String order) {
        String text = trimText(order);
        return saveLabel(text);
    }

    /**
     * Trim the noisy parts of one order.
     */
    public static String trimText(String order) {
        return stripNoise(order);
    }

    /**
     * Remove the whitespace noise of one text.
     */
    public static String stripNoise(String text) {
        return text.trim();
    }

    /**
     * Keep one label in the local store.
     */
    public static String saveLabel(String label) {
        return label;
    }

    /**
     * Publish one record to the outside world.
     */
    public static String publishRecord(String record) {
        return record;
    }
}
