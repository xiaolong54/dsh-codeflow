/**
 * Application shell of the fixture project.
 */
public class App {

    /**
     * Run one order through the whole pipeline.
     */
    public static String run(String order) {
        Service service = new Service("ord");
        return service.process(order);
    }

    /**
     * Summarize one order for the legacy report tool.
     *
     * Nothing in the fixture calls this function.
     */
    public static String legacyReport(String order) {
        return order;
    }
}
