package main

// defaultPrefix is the identifier prefix used by the fixture service.
const defaultPrefix = "ord"

// Service turns raw orders into stored records.
type Service struct {
	prefix string
}

// NewService creates a service with the given identifier prefix.
func NewService(prefix string) *Service {
	return &Service{prefix: prefix}
}

// Process processes one order and stores the resulting record.
func (s *Service) Process(order string) string {
	record := BuildRecord(order)
	SaveRecord(record)
	PublishRecord(record)
	return s.Describe(record)
}

// Describe describes one record in a single line.
func (s *Service) Describe(record string) string {
	label := FormatLabel(record)
	return NormalizeText(label)
}

// BuildRecord builds the record of one order.
func BuildRecord(order string) string {
	return order
}

// SaveRecord keeps one record in the local store.
func SaveRecord(record string) string {
	return record
}
