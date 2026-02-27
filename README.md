# k8s-spring-microservices

A hands-on learning project for Kubernetes fundamentals through the lens of Spring Boot microservices.

## Purpose of This README

This file is the **public-facing entry point** for the project — a quick orientation for anyone
(including future you) cloning this repo. It tells you what the project is, how to get it running,
and where to find everything.

For the full project guide, architecture decisions, progress tracking, and lesson curriculum,
see [`CLAUDE.md`](CLAUDE.md).

For step-by-step learning content, see the [`lessons/`](lessons/) directory.

---

## What is This?

**ShopNow** — a shopping platform built as a set of Spring Boot microservices, deployed on
Kubernetes (Minikube). Every service is chosen specifically to introduce one or more core
Kubernetes concepts. The Angular frontend is served via nginx.

See [`CLAUDE.md`](CLAUDE.md) for the full architecture diagram and service list.

---

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| Docker | 24+ | https://docs.docker.com/get-docker |
| Minikube | 1.32+ | https://minikube.sigs.k8s.io/docs/start |
| kubectl | 1.29+ | https://kubernetes.io/docs/tasks/tools |
| Java | 21 | https://adoptium.net |
| Node | 20+ | https://nodejs.org |
| Angular CLI | 17+ | `npm install -g @angular/cli` |

---

## Quick Start

```bash
# 1. Start the cluster
minikube start --cpus=4 --memory=8192 --driver=docker

# 2. Enable required addons
minikube addons enable ingress
minikube addons enable metrics-server

# 3. Create the project namespace
kubectl apply -f k8s/namespaces/shopnow.yaml
```

---

## Useful Commands

### Cluster

```bash
# Start / stop the cluster
minikube start --cpus=4 --memory=8192
minikube stop

# Open the Kubernetes web dashboard
minikube dashboard

# Get the Minikube node IP (for NodePort access)
minikube ip
```

### Building Images

```bash
# Point your Docker CLI at Minikube's daemon (run this in every new terminal)
eval $(minikube docker-env)

# Build a service image directly into Minikube (no registry needed)
docker build -t shopnow/<service-name>:latest services/<service-name>/
```

### Applying Manifests

```bash
# Apply all manifests for a single service
kubectl apply -f k8s/<service-name>/

# Apply everything at once
kubectl apply -R -f k8s/
```

### Inspecting Resources

```bash
# List everything in the shopnow namespace
kubectl get all -n shopnow

# Describe a resource (events, config, status)
kubectl describe deployment/<service-name> -n shopnow
kubectl describe pod/<pod-name> -n shopnow

# Tail logs for a deployment
kubectl logs -f deployment/<service-name> -n shopnow

# Tail logs for a specific container in a multi-container pod
kubectl logs -f <pod-name> -c <container-name> -n shopnow
```

### Debugging

```bash
# Run a throwaway debug pod inside the cluster
kubectl run debug --image=busybox:latest --restart=Never -it --rm -n shopnow -- sh

# Execute a command in a running pod
kubectl exec -it <pod-name> -n shopnow -- sh

# Port-forward a service to your laptop for local testing
kubectl port-forward svc/<service-name> <local-port>:<remote-port> -n shopnow

# Open a NodePort service directly in your browser
minikube service <service-name> -n shopnow
```

### Rollouts

```bash
# Watch a rollout in progress
kubectl rollout status deployment/<service-name> -n shopnow

# View rollout history
kubectl rollout history deployment/<service-name> -n shopnow

# Roll back to the previous version
kubectl rollout undo deployment/<service-name> -n shopnow
```

### Scaling

```bash
kubectl scale deployment/<service-name> --replicas=3 -n shopnow
```

### Cleanup

```bash
# Delete all resources for a service
kubectl delete -f k8s/<service-name>/

# Delete the entire namespace and everything in it
kubectl delete namespace shopnow

# Wipe and restart Minikube from scratch
minikube delete && minikube start --cpus=4 --memory=8192
```

---

## Project Structure

```
k8s-spring-microservices/
├── CLAUDE.md          ← Full project guide, architecture, and progress tracker
├── lessons/           ← Lesson markdown files — read these as you build
├── k8s/               ← Kubernetes manifests
├── services/          ← Spring Boot source code
├── frontend/          ← Angular app
└── helm/              ← Helm chart (added in Lesson 19)
```

---

## Where to Start

Open [`lessons/lesson-01-setup.md`](lessons/lesson-01-setup.md) and follow the tasks in order.
Each lesson builds on the last and introduces new Kubernetes concepts tied to a real service.
