# Lesson 07 — Service Discovery: Deploying Eureka

**Status:** [x] Complete
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

## Concept: Chicken-and-Egg — Why Discovery Server Doesn't Use Config Server

Config-server registers itself with Eureka. That means Eureka must be running before
config-server starts. So discovery-server **cannot** fetch its own config from config-server —
it would be waiting for itself.

The solution: discovery-server's config is baked into its local `application.yml` inside
the JAR. No ConfigMap mount is needed.

---

## Your Task

### 1. Implement the Discovery Server Spring Boot app

In `services/discovery-server/`, create a Spring Boot app. The pom.xml needs two dependencies:

```xml
<!-- Eureka server -->
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-netflix-eureka-server</artifactId>
</dependency>

<!-- Actuator — required for the liveness probe in step 4 -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-actuator</artifactId>
</dependency>
```

Annotate your main class with `@EnableEurekaServer`:

```java
@SpringBootApplication
@EnableEurekaServer
public class DiscoveryServerApplication {
    public static void main(String[] args) {
        SpringApplication.run(DiscoveryServerApplication.class, args);
    }
}
```

`src/main/resources/application.yml` — config is baked in (no ConfigMap needed):

```yaml
spring:
  application:
    name: discovery-server

server:
  port: 8761

eureka:
  instance:
    hostname: discovery-server        # K8s DNS name other services will use
  client:
    register-with-eureka: false       # Don't register with itself
    fetch-registry: false             # Don't fetch registry from itself
  server:
    wait-time-in-ms-when-sync-empty: 0  # Start immediately without waiting for peers
```

### 2. Build the image with Buildpacks

No Dockerfile needed — Spring Boot's Maven plugin handles it:

```bash
# Point Docker at Minikube's daemon
eval $(minikube docker-env)

# Build the image
cd services/discovery-server
./mvnw spring-boot:build-image -Dspring-boot.build-image.imageName=shopnow/discovery-server:latest
cd ../..

# Confirm the image is available inside Minikube
docker images | grep discovery-server
```

### 3. Update the Deployment to use your image

Replace the `nginx:alpine` placeholder in `k8s/discovery-server/deployment.yaml`
with your real image and add a liveness probe:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: discovery-server
  namespace: shopnow
  labels:
    app: discovery-server
    part-of: shopnow
    version: "1.0"
spec:
  replicas: 1
  selector:
    matchLabels:
      app: discovery-server
  template:
    metadata:
      labels:
        app: discovery-server
        part-of: shopnow
        version: "1.0"
    spec:
      containers:
        - name: discovery-server
          image: shopnow/discovery-server:latest
          imagePullPolicy: Never
          ports:
            - containerPort: 8761
          livenessProbe:
            httpGet:
              path: /actuator/health
              port: 8761
            initialDelaySeconds: 60   # Eureka takes ~30-60s to fully start
            periodSeconds: 10
          resources:
            requests:
              memory: "512Mi"
              cpu: "250m"
            limits:
              memory: "768Mi"    # Eureka's fixed JVM regions alone exceed 600MB; 512Mi is too low
              cpu: "500m"
```

> **Why `initialDelaySeconds: 60`?** Eureka initialises its internal registry structures
> before it starts serving traffic. K8s will restart the pod unnecessarily if it probes
> too early. Health probes are covered in depth in Lesson 08.

### 4. Apply and verify

```bash
kubectl apply -f k8s/discovery-server/deployment.yaml
kubectl rollout status deployment/discovery-server -n shopnow --timeout=120s

# Open the Eureka dashboard in your browser
minikube service discovery-server-external -n shopnow
```

You should see the Eureka dashboard with **no instances registered** — correct, since
no other services are deployed yet.

---

## Notes & Learnings

> _Record anything surprising, problems you hit, or insights you had._

---

## Up Next

[Lesson 08 — Health Probes: Product Service Deployment](lesson-08-product-service.md)
