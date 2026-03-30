# Network Security

> Last Updated: 2026-03-28

## Overview

All pods in the `browser-streamer` namespace operate under **default-deny ingress and egress**. Each workload has explicit NetworkPolicy and CiliumNetworkPolicy rules that whitelist only the traffic it needs. External HTTPS egress from the control-plane is locked to specific FQDNs via Cilium's eBPF-based DNS-aware policies.

## CNI

Production runs **Cilium** (v1.17.0) on k3s with:
- VXLAN tunnel mode (Hetzner nodes are in separate /24 subnets — native routing doesn't work)
- WireGuard encryption (all pod-to-pod traffic encrypted)
- Kube-proxy replacement (eBPF-based service routing)
- Standard Kubernetes NetworkPolicy enforcement
- FQDN-based egress rules (`CiliumNetworkPolicy` with `toFQDNs`)

Cilium config: `k8s/networking/cilium-values.yaml`. Managed via `make prod/k8s/cilium/install` (not part of CI deploy — one-time install).

**Key limitation: Cilium's kube-proxy replacement rewrites ClusterIP destinations via eBPF *before* NetworkPolicy evaluation.** This means egress rules using `podSelector`, `namespaceSelector`, or `ipBlock` on ClusterIP addresses don't match. Control-plane egress rules use port-only selectors (no `to:` field) as a workaround. Ingress rules are unaffected.

Local development uses Kind with kindnet (no NetworkPolicy enforcement).

## Policy Files

| File | Type | Purpose |
|------|------|---------|
| `k8s/networking/network-policies.yaml` | `NetworkPolicy` | Default deny, intra-cluster allow rules |
| `k8s/networking/cilium-network-policies.yaml` | `CiliumNetworkPolicy` | FQDN-based external egress restrictions |

## Per-Pod Rules

### control-plane

The public-facing API server. Most restricted egress of any pod.

**Ingress:**
| Source | Port | Purpose |
|--------|------|---------|
| Traefik (traefik namespace) | 8080 | Public API + web SPA |
| Prometheus (monitoring namespace) | 8080 | Metrics scraping |
| Ingest pods | 9090 | RTMP on_publish callbacks |

**Egress (cluster-internal, port-only rules due to Cilium kube-proxy replacement):**
| Port | Purpose |
|------|---------|
| 53 UDP/TCP (to kube-system) | Name resolution |
| 443, 6443 | K8s API — CRD management, pod lifecycle, leader election |
| 5432 | Postgres database |
| 8080 | Streamer management API + ingest HLS proxy |
| 9090 | Ingest RTMP callbacks |

**Egress (external, FQDN-locked via Cilium):**
| Host | Port | Purpose |
|------|------|---------|
| `api.clerk.com`, `api.clerk.dev` | 443 | Auth API |
| `*.clerk.accounts.dev` | 443 | JWKS key fetching |
| `rest.runpod.io` | 443 | GPU pod provisioning |
| `d7190540717efd7404fee7b5263e1443.r2.cloudflarestorage.com` | 443 | R2 object storage (pinned to our account) |
| `id.twitch.tv`, `api.twitch.tv` | 443 | Twitch OAuth + API |
| `accounts.google.com`, `oauth2.googleapis.com`, `www.googleapis.com` | 443 | YouTube OAuth + API |
| `id.kick.com`, `api.kick.com` | 443 | Kick OAuth + API |
| `api.restream.io` | 443 | Restream OAuth + API |
| GPU node IPs (dynamic /32 allowlist) | any | GPU sidecar mTLS — managed by `control-plane-egress-gpu-nodes` CiliumNetworkPolicy |

All other external egress is **denied**. No SSH, SMTP, or arbitrary HTTPS to unlisted hosts.

### postgres

**Ingress:** control-plane on port 5432 only.

**Egress:** DNS only. No outbound connections.

### streamer-stage

User-facing browser pods running Chrome. Needs internet access for loading web content but is port-restricted.

**Ingress:**
| Source | Port | Purpose |
|--------|------|---------|
| control-plane | 8080 | ConnectRPC management |
| Prometheus (monitoring namespace) | 8080 | Metrics scraping |

**Egress (cluster-internal):**
| Destination | Port | Purpose |
|-------------|------|---------|
| kube-system (DNS) | 53 UDP/TCP | Name resolution |
| ingest pods | 1935 | RTMP stream output |

**Egress (external):**
| Destination | Port | Purpose |
|-------------|------|---------|
| Any non-RFC1918 IP | 80, 443 | Chrome loading web content (HTTP/HTTPS only) |

All other ports (SSH, SMTP, arbitrary TCP) are **denied**.

### ingest

RTMP receiver (nginx-rtmp).

**Ingress:**
| Source | Port | Purpose |
|--------|------|---------|
| Any (via LB/NodePort) | 1935 | RTMP ingestion |
| control-plane | 8080 | HLS serving |

**Egress:**
| Destination | Port | Purpose |
|-------------|------|---------|
| kube-system (DNS) | 53 UDP/TCP | Name resolution |
| control-plane | 9090 | RTMP on_publish callbacks |

## Known Limitations

- **Control-plane egress uses port-only rules** — Cilium's kube-proxy replacement DNATs ClusterIP destinations before policy eval, so `podSelector`/`ipBlock` matching is unreliable for service traffic. Port-only rules are less restrictive but functional. Ingress policies are unaffected since traffic arrives at the pod IP directly.
- **Ingest RTMP (port 1935) has no source restriction** — Hetzner LB uses SNAT, so the original client IP is lost by the time traffic reaches the pod. Fixing this requires enabling proxy protocol on the LB, which nginx-rtmp doesn't support natively.
- **GPU sidecar egress uses dynamic IP allowlisting** — The GPU node controller manages a CiliumNetworkPolicy (`control-plane-egress-gpu-nodes`) that restricts egress to only the `/32` IPs of known GPU nodes. The allowlist is reconciled every 10 seconds and on startup recovery. mTLS with CA verification provides the authentication layer on top of the network restriction.
- **Local dev (Kind) has no NetworkPolicy enforcement** — kindnet doesn't support it. Policies are only enforced in production with Cilium.
- **Pods created before Cilium migration have stale networking** — Any pod from the Flannel era must be restarted to get Cilium-managed interfaces. Symptoms: `no route to host` for cross-node traffic.

## Adding a New External Dependency

If the control-plane needs to talk to a new external service:

1. Add the FQDN to `k8s/networking/cilium-network-policies.yaml` under `control-plane-egress-fqdn`
2. Update this doc
3. Deploy — Cilium picks up policy changes without pod restarts
