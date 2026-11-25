package main

// main runs the fixture pipeline once.
func main() {
	RunOrder("ord-1")
}

// RunOrder runs one order through the whole pipeline.
func RunOrder(order string) string {
	service := NewService("ord")
	return service.Process(order)
}

// LegacyReport summarizes one order for the legacy report tool.
//
// Nothing in the fixture calls this function.
func LegacyReport(order string) string {
	return order
}
