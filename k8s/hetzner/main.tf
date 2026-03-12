locals {
  hcloud_token    = var.hcloud_token
  ssh_private_key = data.sops_file.ssh_key.raw
}

data "sops_file" "ssh_key" {
  source_file = "${path.module}/ssh_key.enc"
  input_type  = "raw"
}

module "kube-hetzner" {
  providers = {
    hcloud = hcloud
  }

  source  = "kube-hetzner/kube-hetzner/hcloud"
  # Pin to a specific version for reproducibility
  # See https://registry.terraform.io/modules/kube-hetzner/kube-hetzner/hcloud for available versions

  hcloud_token = local.hcloud_token

  ssh_public_key  = file("${path.module}/ssh_key.pub")
  ssh_private_key = local.ssh_private_key

  network_region = var.network_region

  # --- Control Plane (3 nodes for HA / etcd quorum) ---
  control_plane_nodepools = [
    {
      name        = "cp-ash1"
      server_type = var.control_plane_server_type
      location    = "ash"
      labels      = []
      taints      = []
      count       = 1
      backups     = true
    },
    {
      name        = "cp-ash2"
      server_type = var.control_plane_server_type
      location    = "ash"
      labels      = []
      taints      = []
      count       = 1
      backups     = true
    },
    {
      name        = "cp-ash3"
      server_type = var.control_plane_server_type
      location    = "ash"
      labels      = []
      taints      = []
      count       = 1
      backups     = true
    },
  ]

  # --- Agent Workers (2 beefy nodes, US) ---
  agent_nodepools = [
    {
      name        = "worker-ash"
      server_type = var.agent_server_type
      location    = "ash"
      labels      = []
      taints      = []
      count       = 1
    },
    {
      name        = "worker-ash2"
      server_type = var.agent_server_type
      location    = "ash"
      labels      = []
      taints      = []
      count       = 1
    },
  ]

  # --- Autoscaler (burst capacity) ---
  autoscaler_nodepools = [
    {
      name        = "autoscaled-workers"
      server_type = var.agent_server_type
      location    = "ash"
      min_nodes   = 0
      max_nodes   = 6
    }
  ]

  # --- Load Balancer ---
  load_balancer_type     = "lb11"
  load_balancer_location = "ash"

  # --- Ingress ---
  ingress_controller = "traefik"

  # --- Networking ---
  enable_wireguard = true

  # --- Storage ---
  # Hetzner CSI is enabled by default for persistent volumes.
  # Enable Longhorn if you need replicated distributed storage:
  # enable_longhorn = true

  # --- DNS ---
  dns_servers = [
    "1.1.1.1",
    "8.8.8.8",
    "2606:4700:4700::1111",
  ]

  # --- Firewall ---
  firewall_ssh_source      = var.firewall_ssh_source
  firewall_kube_api_source = var.firewall_kube_api_source

  extra_firewall_rules = [
    {
      description     = "Allow outbound RTMP streaming"
      direction       = "out"
      protocol        = "tcp"
      port            = "1935"
      source_ips      = []
      destination_ips = ["0.0.0.0/0", "::/0"]
    },
  ]

  # --- Misc ---
  allow_scheduling_on_control_plane = false
  automatically_upgrade_k3s         = false
  initial_k3s_channel               = "stable"

  # Use Helm-based CCM (recommended for new installs)
  hetzner_ccm_use_helm = true
}
