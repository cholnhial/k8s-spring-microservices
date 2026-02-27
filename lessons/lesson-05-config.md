# Lesson 05 — ConfigMaps & Secrets: Spring Cloud Config Server

**Status:** [ ] Complete
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

### 1. Build the Spring Cloud Config Server

In `services/config-server/`, create a Spring Boot app that:
- Has `spring-cloud-config-server` dependency
- Reads config from a Git repo (or local filesystem for simplicity)
- Is annotated with `@EnableConfigServer`

> I will scaffold the `pom.xml` and `application.yml` for you. You implement the class.

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

### 4. Mount the ConfigMap as a file in the Deployment

Create `k8s/config-server/deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: config-server
  namespace: shopnow
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
    spec:
      containers:
        - name: config-server
          image: shopnow/config-server:latest
          imagePullPolicy: Never
          ports:
            - containerPort: 8888
          volumeMounts:
            - name: config-volume
              mountPath: /config           # Spring Boot looks here by default
      volumes:
        - name: config-volume
          configMap:
            name: config-server-config
```

### 5. Inject a Secret as environment variables

```yaml
# Inside the container spec:
envFrom:
  - secretRef:
      name: git-credentials     # All keys become env vars: USERNAME, PASSWORD
```

Or individually:

```yaml
env:
  - name: SPRING_CLOUD_CONFIG_SERVER_GIT_USERNAME
    valueFrom:
      secretKeyRef:
        name: git-credentials
        key: username
```

### 6. Verify config server is working

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
