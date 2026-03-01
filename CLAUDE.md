# CLAUDE.md — Kubernetes + Spring Boot Learning Project

## About This File
This file governs how I (Claude) behave in this project. It is also the living source of truth
for project structure, progress, and conventions. Update it as we make decisions together.

---

## My Role as Tutor

- I **create scaffolding** (folder structures, skeleton files, K8s manifests, config stubs).
- I **explain every concept** before we implement it, linking to the relevant lesson file.
- I **leave the implementation to you** — I will not write your Spring Boot business logic for you.
- I **update lessons/** with notes, diagrams, and references as we learn together.
- I **track your progress** in the checklist below and tick items off as you complete them.
- I will ask before making structural decisions that affect multiple services.

---

## Project: ShopNow

A fully microserviced shopping platform built to teach Kubernetes fundamentals through real,
production-relevant patterns. Every service exists to introduce one or more K8s concepts.

### Architecture

```
                          ┌─────────────────────────────────┐
                          │         Minikube Cluster         │
                          │                                  │
  Browser ──► Ingress ──► │  nginx-frontend  api-gateway     │
                          │       │               │          │
                          │  ┌────▼───────────────▼────┐    │
                          │  │   Spring Cloud Gateway   │    │
                          │  └──┬──────┬──────┬──────┬──┘    │
                          │     │      │      │      │       │
                          │  product order  user  inventory  │
                          │  service service service service  │
                          │     │      │             │       │
                          │  pg-db   pg-db          pg-db    │
                          │                                  │
                          │  cart-service ── redis           │
                          │  notification-service ── kafka   │
                          │  config-server                   │
                          │  discovery-server (Eureka)       │
                          │  zipkin (tracing)                │
                          └─────────────────────────────────┘
```

### Services

| Service | Port | Pattern Introduced | K8s Concept Introduced |
|---|---|---|---|
| `discovery-server` | 8761 | Service Discovery (Eureka) | Deployment, ReplicaSet, Service (ClusterIP) |
| `config-server` | 8888 | Centralised Config | ConfigMap, Secret |
| `api-gateway` | 8080 | API Gateway | Ingress, IngressController |
| `product-service` | 8081 | REST + Persistence | StatefulSet, PVC, PV (PostgreSQL) |
| `order-service` | 8082 | Distributed Transactions (Saga) | Namespaces, ResourceLimits |
| `inventory-service` | 8083 | Circuit Breaker (Resilience4j) | Liveness/Readiness Probes |
| `user-service` | 8084 | Auth / JWT | RBAC, ServiceAccount |
| `cart-service` | 8085 | Cache-aside (Redis) | StatefulSet (Redis) |
| `notification-service` | 8086 | Event-driven (Kafka) | Headless Service, StatefulSet (Kafka) |
| `frontend` | 80 | — | ConfigMap for nginx.conf, Deployment |

### Tech Stack

- **Java 21** + **Spring Boot 3.x**
- **Spring Cloud** (Gateway, Eureka, Config, OpenFeign, Resilience4j)
- **PostgreSQL 16** (product, order, inventory, user DBs)
- **Redis 7** (cart)
- **Apache Kafka 3** (events)
- **Angular 17** + **nginx** (frontend)
- **Zipkin** (distributed tracing)
- **Minikube** (local K8s cluster)
- **kubectl** + **Helm 3** (cluster tooling)

---

## Curriculum & Progress

Work through lessons in order. Each builds on the last.
Tick a box by changing `[ ]` to `[x]`.

### Phase 1 — Environment & Foundations

- [x] **Lesson 01** — [Project Overview & Minikube Setup](lessons/lesson-01-setup.md)
- [x] **Lesson 02** — [Pods & Containers: The Atomic Unit of K8s](lessons/lesson-02-pods.md)
- [x] **Lesson 03** — [Deployments & ReplicaSets: Self-Healing Workloads](lessons/lesson-03-deployments.md)
- [x] **Lesson 04** — [Services & Networking: Exposing Workloads](lessons/lesson-04-services.md)

### Phase 2 — Infrastructure Services

- [x] **Lesson 05** — [ConfigMaps & Secrets: Spring Cloud Config Server](lessons/lesson-05-config.md)
- [x] **Lesson 06** — [StatefulSets & PVCs: Running PostgreSQL](lessons/lesson-06-statefulsets.md)
- [x] **Lesson 07** — [Service Discovery: Deploying Eureka](lessons/lesson-07-discovery.md)

### Phase 3 — Core Application Services

- [x] **Lesson 08** — [Health Probes: Product Service Deployment](lessons/lesson-08-product-service.md)
- [x] **Lesson 09** — [Ingress: API Gateway as the Single Entry Point](lessons/lesson-09-ingress.md)
- [x] **Lesson 10** — [Namespaces & Resource Limits: Order Service](lessons/lesson-10-order-service.md)
- [ ] **Lesson 11** — [Circuit Breaker & Resilience: Inventory Service](lessons/lesson-11-inventory-service.md)
- [ ] **Lesson 12** — [RBAC & ServiceAccounts: User Service](lessons/lesson-12-user-service.md)

### Phase 4 — Stateful & Event-Driven Services

- [ ] **Lesson 13** — [Redis StatefulSet: Cart Service](lessons/lesson-13-cart-service.md)
- [ ] **Lesson 14** — [Kafka StatefulSet & Headless Services: Notification Service](lessons/lesson-14-notification-service.md)

### Phase 5 — Frontend & Observability

- [ ] **Lesson 15** — [nginx + Angular: Frontend Deployment](lessons/lesson-15-frontend.md)
- [ ] **Lesson 16** — [Sidecar Pattern: Distributed Tracing with Zipkin](lessons/lesson-16-tracing.md)

### Phase 6 — Production Readiness

- [ ] **Lesson 17** — [HorizontalPodAutoscaler: Scaling Services](lessons/lesson-17-hpa.md)
- [ ] **Lesson 18** — [Rolling Updates, Rollbacks & Blue/Green Deploys](lessons/lesson-18-updates.md)
- [ ] **Lesson 19** — [Helm Charts: Packaging the Platform](lessons/lesson-19-helm.md)
- [ ] **Lesson 20** — [NetworkPolicy, ResourceQuotas & Hardening](lessons/lesson-20-hardening.md)

---

## Project Directory Structure

```
k8s-spring-microservices/
├── CLAUDE.md                        ← You are here
├── lessons/                         ← Lesson markdown files (reference + notes)
├── k8s/                             ← Raw Kubernetes manifests
│   ├── namespaces/
│   ├── infrastructure/              ← postgres, redis, kafka, zipkin
│   ├── discovery-server/
│   ├── config-server/
│   ├── api-gateway/
│   ├── product-service/
│   ├── order-service/
│   ├── inventory-service/
│   ├── user-service/
│   ├── cart-service/
│   ├── notification-service/
│   └── frontend/
├── helm/                            ← Helm chart (Phase 6)
├── services/                        ← Spring Boot source code
│   ├── discovery-server/
│   ├── config-server/
│   ├── api-gateway/
│   ├── product-service/
│   ├── order-service/
│   ├── inventory-service/
│   ├── user-service/
│   ├── cart-service/
│   └── notification-service/
└── frontend/                        ← Angular app
```

---

## Conventions

- **Namespace:** All services run in namespace `shopnow` unless noted otherwise.
- **Image naming:** `shopnow/<service-name>:latest` — built with `minikube image build`.
- **Port convention:** Internal container ports follow the table above; K8s Services use the same port.
- **Config:** All Spring Boot config goes through `config-server`; local `bootstrap.yml` only holds the config server URL and app name.
- **Secrets:** Database passwords, JWT secrets, and API keys are always `kind: Secret`, never in a ConfigMap.
- **Labels:** Every K8s resource carries at minimum:
  ```yaml
  labels:
    app: <service-name>
    part-of: shopnow
    version: "1.0"
  ```

---

## Useful Commands (Quick Reference)

```bash
# Start the cluster
minikube start --cpus=4 --memory=8192

# Build an image directly into Minikube (no registry needed)
eval $(minikube docker-env)
docker build -t shopnow/<service>:latest services/<service>/

# Apply all manifests for a service
kubectl apply -f k8s/<service>/

# Tail logs
kubectl logs -f deployment/<service> -n shopnow

# Port-forward for local testing
kubectl port-forward svc/<service> <local>:<remote> -n shopnow

# Open the Minikube dashboard
minikube dashboard
```

---

## Key Decisions Log

| # | Decision | Rationale |
|---|---|---|
| 1 | Minikube for local cluster | Simplest local setup; teaches real K8s without cloud cost |
| 2 | Eureka over K8s-native discovery | Teaches Spring Cloud patterns before relying on K8s DNS |
| 3 | Raw manifests before Helm | Understand the primitives before the abstraction |
| 4 | PostgreSQL per service (not shared) | Database-per-service is the correct microservices pattern |
| 5 | Angular + nginx frontend | Allows nginx ConfigMap lesson and static asset serving |