/**
 * Order service of the fixture project.
 */

/**
 * Turns raw orders into stored records.
 */
public class Service
{
    /// <summary>Prefix used for generated identifiers.</summary>
    public const string Prefix = "ord";

    private readonly string prefix;

    /**
     * Create the service with the given identifier prefix.
     */
    public Service(string prefix)
    {
        this.prefix = prefix;
    }

    /**
     * Process one order and store the resulting record.
     */
    public string Process(string order)
    {
        string record = BuildRecord(order);
        SaveRecord(record);
        Helpers.PublishRecord(record);
        return this.Describe(record);
    }

    /**
     * Describe one record in a single line.
     */
    public string Describe(string record)
    {
        string label = Helpers.FormatLabel(record);
        return Helpers.NormalizeText(label);
    }

    /**
     * Build the record of one order.
     */
    public static string BuildRecord(string order)
    {
        return order;
    }

    /**
     * Keep one record in the local store.
     */
    public static string SaveRecord(string record)
    {
        return record;
    }
}
