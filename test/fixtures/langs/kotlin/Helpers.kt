package fixture

/**
 * Shared helpers of the fixture project.
 */

/**
 * Build a short label for one order.
 *
 * The label is trimmed first and then kept in the local store.
 */
fun formatLabel(order: String): String {
    val text = trimText(order)
    return saveLabel(text)
}

/**
 * Trim the noisy parts of one order.
 */
fun trimText(order: String): String {
    return stripNoise(order)
}

/**
 * Remove the whitespace noise of one text.
 */
fun stripNoise(text: String): String {
    return text.trim()
}

/**
 * Keep one label in the local store.
 */
fun saveLabel(label: String): String {
    return label
}

/**
 * Publish one record to the outside world.
 */
fun publishRecord(record: String): String {
    return record
}
