variable "hcloud_token" {
  description = "Hetzner Cloud API token (read/write)"
  type        = string
  sensitive   = true
}


variable "network_region" {
  description = "Hetzner network region (eu-central or us-east)"
  type        = string
  default     = "us-east"
}

variable "control_plane_server_type" {
  description = "Server type for control plane nodes"
  type        = string
  default     = "cpx21" # 3 vCPU / 4 GB — lightweight for etcd + API server
}

variable "agent_server_type" {
  description = "Server type for agent/worker nodes"
  type        = string
  default     = "ccx43" # 16 dedicated vCPU / 64 GB RAM
}
