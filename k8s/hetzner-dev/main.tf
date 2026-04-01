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
  version = "~> 2.19.0"

  cluster_name = "dev"

  hcloud_token = local.hcloud_token

  ssh_public_key  = file("${path.module}/ssh_key.pub")
  ssh_private_key = local.ssh_private_key

  network_region = var.network_region

  # --- Control Plane (single node — no HA needed for dev) ---
  control_plane_nodepools = [
    {
      name        = "dev-cp-ash"
      server_type = var.control_plane_server_type
      location    = "ash"
      labels      = []
      taints      = []
      count       = 1
      backups     = false
    },
  ]

  # --- Agent Worker (single node for PR environments) ---
  agent_nodepools = [
    {
      name        = "dev-worker-ash"
      server_type = var.agent_server_type
      location    = "ash"
      labels      = []
      taints      = []
      count       = 1
    },
  ]

  # No autoscaler — add a second worker manually if needed

  # --- Load Balancer ---
  load_balancer_type     = "lb11"
  load_balancer_location = "ash"

  # --- Ingress ---
  ingress_controller = "traefik"

  # --- Networking ---
  cni_plugin       = "cilium"
  cilium_version   = "1.17.0"
  enable_wireguard = true

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
      description     = "Allow Tailscale UDP inbound (WireGuard + STUN)"
      direction       = "in"
      protocol        = "udp"
      port            = "3478"
      source_ips      = ["0.0.0.0/0", "::/0"]
      destination_ips = []
    },
    {
      description     = "Allow Tailscale UDP inbound (WireGuard direct)"
      direction       = "in"
      protocol        = "udp"
      port            = "41641"
      source_ips      = ["0.0.0.0/0", "::/0"]
      destination_ips = []
    },
    {
      description     = "Allow outbound UDP (Tailscale WireGuard + STUN)"
      direction       = "out"
      protocol        = "udp"
      port            = "1-65535"
      source_ips      = []
      destination_ips = ["0.0.0.0/0", "::/0"]
    },
    {
      description     = "Allow outbound RTMP streaming"
      direction       = "out"
      protocol        = "tcp"
      port            = "1935"
      source_ips      = []
      destination_ips = ["0.0.0.0/0", "::/0"]
    },
    {
      description     = "Allow outbound to RunPod GPU nodes"
      direction       = "out"
      protocol        = "tcp"
      port            = "1024-65535"
      source_ips      = []
      destination_ips = ["0.0.0.0/0", "::/0"]
    },
  ]

  # No audit logging — unnecessary overhead for dev

  # GitHub Actions OIDC authentication (same as prod)
  k3s_exec_server_args = join(" ", [
    "--kube-apiserver-arg=oidc-issuer-url=https://token.actions.githubusercontent.com",
    "--kube-apiserver-arg=oidc-client-id=kubernetes",
    "--kube-apiserver-arg=oidc-username-claim=sub",
    "--kube-apiserver-arg=oidc-username-prefix=github:",
    "--kube-apiserver-arg=oidc-groups-claim=repository",
  ])

  # --- Misc ---
  allow_scheduling_on_control_plane = true # squeeze capacity from 2 nodes
  automatically_upgrade_k3s         = false
  automatically_upgrade_os          = false
  initial_k3s_channel               = "stable"

}
