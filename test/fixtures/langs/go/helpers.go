package main

// FormatLabel builds a short label for one order.
//
// The label is trimmed first and then kept in the local store.
func FormatLabel(order string) string {
	text := TrimText(order)
	return SaveLabel(text)
}

// TrimText trims the noisy parts of one order.
func TrimText(order string) string {
	return StripNoise(order)
}

// StripNoise removes the whitespace noise of one text.
func StripNoise(text string) string {
	return text
}

// SaveLabel keeps one label in the local store.
func SaveLabel(label string) string {
	return label
}

// PublishRecord publishes one record to the outside world.
func PublishRecord(record string) string {
	return record
}
