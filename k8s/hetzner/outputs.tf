output "kubeconfig" {
  description = "Kubeconfig for the provisioned cluster"
  value       = module.kube-hetzner.kubeconfig
  sensitive   = true
}

output "kubeconfig_file" {
  description = "Write kubeconfig to a file with: tofu output -raw kubeconfig > kubeconfig.yaml"
  value       = "Run: tofu output -raw kubeconfig > kubeconfig.yaml"
}
