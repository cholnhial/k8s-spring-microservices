# Lesson 01 — Project Overview & Minikube Setup

**Status:** [x] Complete
**K8s Concepts:** Cluster, Node, kubectl, minikube
**Spring Boot Concepts:** Project structure, multi-module Maven/Gradle

---

## What You Will Build

By the end of this lesson you will have:
- A running Minikube cluster you can verify with `kubectl`
- The project folder structure created on disk
- An understanding of how Kubernetes fits into the Spring Boot world

---

## Concept: What is Kubernetes?

Kubernetes (K8s) is a **container orchestrator**. Where Docker runs containers on a single machine,
Kubernetes runs them across a *cluster* of machines and handles:

- **Scheduling** — deciding which node a container runs on
- **Self-healing** — restarting failed containers automatically
- **Scaling** — adding or removing container instances based on load
- **Networking** — giving every container a stable virtual IP and DNS name
- **Configuration** — injecting config and secrets without rebuilding images

### Core Vocabulary (you will use these every day)

| Term | What it is |
|---|---|
| **Cluster** | The whole Kubernetes system (control plane + worker nodes) |
| **Node** | A machine (VM or physical) that runs workloads |
| **Pod** | The smallest deployable unit — one or more containers that share a network |
| **Namespace** | A virtual partition inside a cluster (like a folder) |
| **kubectl** | The CLI you use to talk to the cluster |

### Minikube

Minikube runs a **single-node** Kubernetes cluster inside a VM or container on your laptop.
It is not production Kubernetes — it is a learning sandbox. Everything you learn here
transfers directly to managed K8s (EKS, GKE, AKS).

---

## Prerequisites Checklist

Run these commands to verify your environment before continuing.

```bash
# 1. Docker
docker --version          # Docker 24+ recommended

# 2. Minikube
minikube version          # v1.32+ recommended

# 3. kubectl
kubectl version --client  # v1.29+ recommended

# 4. Java
java --version            # Java 21 required

# 5. Node / Angular CLI (for frontend, needed later)
node --version            # 20+
ng version                # Angular CLI 17+
```

---

## Your Task

### 1. Start Minikube

```bash
minikube start --cpus=4 --memory=8192 --driver=docker
```

> **Why these settings?**
> We will run PostgreSQL, Kafka, Redis, Eureka, Config Server, and multiple Spring Boot apps.
> 4 CPUs and 8 GB RAM is the minimum comfortable baseline. Increase if your machine allows.

### 2. Verify the cluster

```bash
kubectl cluster-info
kubectl get nodes
```

You should see one node with status `Ready`.

### 3. Enable the Ingress addon

```bash
minikube addons enable ingress
kubectl get pods -n ingress-nginx
```

Wait until the ingress controller pod shows `Running`. This is the nginx that will route
external traffic into our cluster later.

### 4. Enable the Metrics Server addon (needed for HPA in Lesson 17)

```bash
minikube addons enable metrics-server
```

### 5. Create the project namespace

```bash
kubectl create namespace shopnow
kubectl get namespaces
```

### 6. Create the project folder structure

Run this from the repo root:

```bash
mkdir -p k8s/{namespaces,infrastructure,discovery-server,config-server,api-gateway,\
product-service,order-service,inventory-service,user-service,cart-service,\
notification-service,frontend}

mkdir -p services/{discovery-server,config-server,api-gateway,product-service,\
order-service,inventory-service,user-service,cart-service,notification-service}

mkdir -p frontend helm
```

### 7. Save the namespace manifest

Create `k8s/namespaces/shopnow.yaml`:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: shopnow
  labels:
    part-of: shopnow
```

Apply it:

```bash
kubectl apply -f k8s/namespaces/shopnow.yaml
```

---

## What to Verify

```bash
kubectl get all -n shopnow   # Should show: No resources found (that is correct for now)
minikube dashboard            # Opens the web UI — explore it
```

---

## Notes & Learnings

> _Use this section to record anything surprising, problems you hit, or insights you had._

---

## Up Next

[Lesson 02 — Pods & Containers](lesson-02-pods.md)
