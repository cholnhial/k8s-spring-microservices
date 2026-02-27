# Lesson 07 — Service Discovery: Deploying Eureka

**Status:** [ ] Complete
**K8s Concepts:** ClusterIP Service, DNS, liveness probes (intro)
**Spring Boot Concepts:** `@EnableEurekaServer`, Eureka client config, `spring-cloud-starter-netflix-eureka-server`

---

## Concept: Two Layers of Discovery

In this project we use **both** Kubernetes DNS and Spring Eureka. Here is why:

| Layer | What it does |
|---|---|
| K8s Service DNS | Routes traffic to healthy Pods; load-balances at L4 |
| Eureka | Application-level registry; allows services to query metadata about each other |

Using Eureka in K8s is a deliberate learning choice so you understand both patterns.
In a pure K8s shop, services use K8s DNS directly and Eureka is not needed.

---

## Your Task

### 1. Implement the Discovery Server Spring Boot app

In `services/discovery-server/` create a Spring Boot app with:
- Dependency: `spring-cloud-starter-netflix-eureka-server`
- Main class annotated with `@EnableEurekaServer`
- `application.yml` that disables self-registration:
  ```yaml
  eureka:
    client:
      register-with-eureka: false
      fetch-registry: false
  ```

### 2. Build and load the image into Minikube

```bash
eval $(minikube docker-env)
docker build -t shopnow/discovery-server:latest services/discovery-server/
```

### 3. Update the Deployment to use your image

Update `k8s/discovery-server/deployment.yaml` to use `shopnow/discovery-server:latest`
with `imagePullPolicy: Never`.

### 4. Add a liveness probe

```yaml
livenessProbe:
  httpGet:
    path: /actuator/health
    port: 8761
  initialDelaySeconds: 60
  periodSeconds: 10
```

### 5. Verify

```bash
minikube service discovery-server-external -n shopnow
# Should see the Eureka dashboard in your browser
```

---

## Notes & Learnings

> _Record anything surprising, problems you hit, or insights you had._

---

## Up Next

[Lesson 08 — Health Probes: Product Service Deployment](lesson-08-product-service.md)
