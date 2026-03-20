package runpod

// PodInput is the request body for creating a RunPod pod.
type PodInput struct {
	Name                    string            `json:"name"`
	ImageName               string            `json:"imageName"`
	GpuTypeIds              []string          `json:"gpuTypeIds"`
	GpuCount                int               `json:"gpuCount"`
	CloudType               string            `json:"cloudType"`
	ContainerDiskInGb       int               `json:"containerDiskInGb"`
	Ports                   []string          `json:"ports,omitempty"`
	Env                     map[string]string `json:"env,omitempty"`
	ContainerRegistryAuthId string            `json:"containerRegistryAuthId,omitempty"`
	AllowedCudaVersions     []string          `json:"allowedCudaVersions,omitempty"`
}

// Pod is the response from the RunPod API.
type Pod struct {
	ID            string         `json:"id"`
	Name          string         `json:"name"`
	DesiredStatus string         `json:"desiredStatus"`
	PublicIp      string         `json:"publicIp"`
	PortMappings  map[string]int `json:"-"` // parsed from portMappings object
	CostPerHr     float64        `json:"costPerHr"`
}

// ErrNotFound is returned when a RunPod pod is not found (404).
type ErrNotFound struct {
	PodID string
}

func (e *ErrNotFound) Error() string {
	return "runpod pod not found: " + e.PodID
}
