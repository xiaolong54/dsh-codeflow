package fixture

/**
 * Application shell of the fixture project.
 */

/**
 * Run one order through the whole pipeline.
 */
fun run(order: String): String {
    val service = Service.make("ord")
    return service.process(order)
}

/**
 * Summarize one order for the legacy report tool.
 *
 * Nothing in the fixture calls this function.
 */
fun legacyReport(order: String): String {
    return order
}
