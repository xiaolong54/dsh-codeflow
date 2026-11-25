/**
 * Shared helpers of the fixture project.
 */
public class Helpers
{
    /**
     * Build a short label for one order.
     *
     * The label is trimmed first and then kept in the local store.
     */
    public static string FormatLabel(string order)
    {
        string text = TrimText(order);
        return SaveLabel(text);
    }

    /**
     * Trim the noisy parts of one order.
     */
    public static string TrimText(string order)
    {
        return StripNoise(order);
    }

    /**
     * Remove the whitespace noise of one text.
     */
    public static string StripNoise(string text)
    {
        return text.Trim();
    }

    /**
     * Keep one label in the local store.
     */
    public static string SaveLabel(string label)
    {
        return label;
    }

    /**
     * Publish one record to the outside world.
     */
    public static string PublishRecord(string record)
    {
        return record;
    }
}
