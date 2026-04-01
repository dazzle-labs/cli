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
  description = "Server type for control plane node"
  type        = string
  default     = "cpx21" # 3 vCPU / 4 GB — single node, no HA needed for dev
}

variable "agent_server_type" {
  description = "Server type for agent/worker nodes"
  type        = string
  default     = "cpx41" # 8 vCPU / 16 GB — enough for ~8 concurrent PR environments
}

variable "ssh_port" {
  description = "SSH port for cluster nodes (non-standard to reduce scanner noise)"
  type        = number
  default     = 2222
}

variable "firewall_ssh_source" {
  description = "CIDR ranges allowed to SSH into nodes (default: blocked)"
  type        = list(string)
  default     = ["174.34.8.214/32"]
}

variable "firewall_kube_api_source" {
  description = "CIDR ranges allowed to reach the k8s API (port 6443). Open by default because GitHub Actions CI needs access and uses dynamic IPs. The API is auth-gated by client certificates in the kubeconfig."
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
}
