/**
 * Application shell of the fixture project.
 */
public class App
{
    /**
     * Run one order through the whole pipeline.
     */
    public static string Run(string order)
    {
        Service service = new Service("ord");
        return service.Process(order);
    }

    /**
     * Summarize one order for the legacy report tool.
     *
     * Nothing in the fixture calls this function.
     */
    public static string LegacyReport(string order)
    {
        return order;
    }
}
