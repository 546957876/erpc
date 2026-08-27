package alchemyaccounts

import "encoding/json"

// Record is the validated account projection used by the Admin store.
// Payload retains every imported field, including fields unknown to Admin.
type Record struct {
	Email           string
	NormalizedEmail string
	Name            string
	ProviderID      string
	APIKey          string
	Payload         json.RawMessage
}

type ImportResult struct {
	Records []Record
	Skipped int
}

type Account struct {
	ID             int64           `json:"id"`
	Email          string          `json:"email"`
	Name           string          `json:"name"`
	ProviderID     string          `json:"providerId"`
	APIKey         string          `json:"apiKey"`
	Payload        json.RawMessage `json:"payload"`
	CreatedAt      string          `json:"createdAt"`
	UpdatedAt      string          `json:"updatedAt"`
	UsedInProjects []string        `json:"usedInProjects,omitempty"`
}
