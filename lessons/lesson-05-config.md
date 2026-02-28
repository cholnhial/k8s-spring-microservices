# Lesson 05 — ConfigMaps & Secrets: Spring Cloud Config Server

**Status:** [x] Complete
**K8s Concepts:** ConfigMap, Secret, environment variables, volume mounts
**Spring Boot Concepts:** Spring Cloud Config Server, `bootstrap.yml`, config client

---

## Concept: ConfigMap

A **ConfigMap** stores non-sensitive configuration as key-value pairs that can be injected
into Pods as environment variables or mounted as files.

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: my-config
data:
  SPRING_PROFILES_ACTIVE: "kubernetes"
  SERVER_PORT: "8080"
  my-config.yaml: |
    spring:
      datasource:
        url: jdbc:postgresql://postgres:5432/mydb
```

## Concept: Secret

A **Secret** stores sensitive values (passwords, tokens, keys). Values are base64 encoded
at rest (not encrypted by default in vanilla K8s — treat them as mildly obfuscated, not secure).

```bash
# Create a secret imperatively (safer — never commits the value to git)
kubectl create secret generic pg-credentials \
  --from-literal=username=shopnow \
  --from-literal=password=supersecret \
  -n shopnow
```

> **Rule:** Database passwords, JWT secrets, and API keys **always** go in a Secret.
> Spring profiles, server ports, and URLs go in a ConfigMap.

---

## Your Task

### 1. The Spring Cloud Config Server (already implemented)

The app lives in `services/config-server/`. Here is what each file does and why.

**`ConfigServerApplication.java`** — the only Spring Boot code needed:

```java
@SpringBootApplication
@EnableConfigServer          // turns this app into a config server
public class ConfigServerApplication {
    public static void main(String[] args) {
        SpringApplication.run(ConfigServerApplication.class, args);
    }
}
```

`@EnableConfigServer` activates the `/config-server/{application}/{profile}` HTTP
endpoints that client services call to fetch their configuration.

---

**`src/main/resources/application.yaml`** — deliberately minimal:

```yaml
spring:
  application:
    name: config-server
```

This is **all** the local YAML contains. The rest of the config (port, git URI, etc.)
is provided at runtime by the ConfigMap mounted at `/config` inside the pod. Spring Boot
always checks `/config/application.yaml` before the classpath, so the mounted file wins.

---

**`pom.xml`** — the only dependency needed beyond the starter parent:

```xml
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-config-server</artifactId>
</dependency>
```

The Spring Cloud BOM (`spring-cloud-dependencies`) manages the version so you don't
have to pin it manually.

### 2. Create the ConfigMap for config-server

Create `k8s/config-server/configmap.yaml`:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: config-server-config
  namespace: shopnow
  labels:
    app: config-server
    part-of: shopnow
data:
  application.yaml: |
    server:
      port: 8888
    spring:
      cloud:
        config:
          server:
            git:
              uri: https://github.com/<your-username>/shopnow-config
              default-label: main
```

### 3. Create a Secret for Git credentials (if private repo)

```bash
kubectl create secret generic git-credentials \
  --from-literal=username=<your-github-username> \
  --from-literal=password=<your-github-pat> \
  -n shopnow
```

### 4. Create the Deployment

Create `k8s/config-server/deployment.yaml`. Note the structure carefully:
- `env` and `volumeMounts` are **inside** the container spec
- `volumes` is **outside** the container spec, at the pod `spec` level
- Use explicit `env` entries (not `envFrom`) so the env var names match the full Spring property path in `UPPER_SNAKE_CASE`

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: config-server
  namespace: shopnow
  labels:
    app: config-server
    part-of: shopnow
    version: "1.0"
spec:
  replicas: 1
  selector:
    matchLabels:
      app: config-server
  template:
    metadata:
      labels:
        app: config-server
        part-of: shopnow
        version: "1.0"
    spec:
      containers:
        - name: config-server
          image: shopnow/config-server:latest
          imagePullPolicy: Never
          ports:
            - containerPort: 8888
          env:
            - name: SPRING_CLOUD_CONFIG_SERVER_GIT_USERNAME
              valueFrom:
                secretKeyRef:
                  name: git-credentials
                  key: username
            - name: SPRING_CLOUD_CONFIG_SERVER_GIT_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: git-credentials
                  key: password
          volumeMounts:
            - name: config-volume
              mountPath: /workspace/config  # Buildpacks sets workdir to /workspace; Spring Boot resolves ./config/ from there
      volumes:
        - name: config-volume
          configMap:
            name: config-server-config
```

> **Common mistakes:** swapping `name` and `mountPath` in `volumeMounts`, placing
> `volumes` inside the container spec, or putting `envFrom` outside the container.

### 5. Create the Service

Create `k8s/config-server/service.yaml` so other pods (and `port-forward`) can reach
config-server by its DNS name `config-server.shopnow.svc.cluster.local`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: config-server
  namespace: shopnow
  labels:
    app: config-server
    part-of: shopnow
    version: "1.0"
spec:
  selector:
    app: config-server
  ports:
    - port: 8888
      targetPort: 8888
```

### 6. Build the image and apply all manifests

No Dockerfile is needed. Spring Boot 3.x can build an OCI-compliant image directly
using **Cloud Native Buildpacks** via the Maven plugin.

```bash
# Point Docker at Minikube's daemon so the image lands inside the cluster
eval $(minikube docker-env)

# Build the image (no Dockerfile required)
cd services/config-server
./mvnw spring-boot:build-image -Dspring-boot.build-image.imageName=shopnow/config-server:latest
cd ../..

# Apply everything in order: ConfigMap first, then Deployment + Service
kubectl apply -f k8s/config-server/configmap.yaml
kubectl apply -f k8s/config-server/deployment.yaml
kubectl apply -f k8s/config-server/service.yaml

# Watch the pod come up
kubectl get pods -n shopnow -w
```

> **Why Buildpacks?** The Spring Boot Maven plugin calls Buildpacks under the hood,
> which analyses your project and produces a layered, production-ready image automatically.
> You get security patches, layer caching, and a JVM tuned for containers — for free.

### 7. Verify config server is working

```bash
kubectl port-forward svc/config-server 8888:8888 -n shopnow

# In another terminal:
curl http://localhost:8888/product-service/kubernetes
```

---

## Spring Boot Config Client Setup

Every service that reads from config-server needs in its `bootstrap.yml`:

```yaml
spring:
  application:
    name: product-service       # Must match the config file name in git repo
  config:
    import: "configserver:http://config-server:8888"
```

---

## Notes & Learnings

> _Record anything surprising, problems you hit, or insights you had._

---

## Up Next

[Lesson 06 — StatefulSets & PVCs: Running PostgreSQL](lesson-06-statefulsets.md)
