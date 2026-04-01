terraform {
  required_version = ">= 1.5.0"

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = ">= 1.49.0"
    }
    sops = {
      source  = "carlpett/sops"
      version = "~> 1.1.0"
    }
    deepmerge = {
      source  = "isometry/deepmerge"
      version = "1.2.1"
    }
  }
}

provider "hcloud" {
  token = var.hcloud_token
}

provider "sops" {}
