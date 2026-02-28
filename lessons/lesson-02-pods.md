# Lesson 02 — Pods & Containers: The Atomic Unit of K8s

**Status:** [x] Complete
**K8s Concepts:** Pod, container, `kubectl run`, `kubectl exec`, `kubectl logs`, image pull policy
**Spring Boot Concepts:** Cloud Native Buildpacks, image pull policy

---

## Concept: What is a Pod?

A **Pod** is the smallest thing Kubernetes knows how to run. It wraps one or more containers
that share:

- The same **network namespace** (same IP, same `localhost`)
- The same **storage volumes**
- The same **lifecycle** (they start and stop together)

In practice, **most Pods contain exactly one container**. Multi-container Pods are used for
specific patterns (sidecar, ambassador, adapter) which we cover in Lesson 16.

```
┌──────────────────────────────┐
│           Pod                │
│  ┌────────────────────────┐  │
│  │  Container             │  │
│  │  image: my-app:1.0     │  │
│  │  port: 8080            │  │
│  └────────────────────────┘  │
│  IP: 10.244.0.5              │
│  Volumes: [...]              │
└──────────────────────────────┘
```

### Pods are ephemeral

Pods **die and are replaced** — they are not pets. When a Pod is killed, a new one gets a
new IP address. This is why we need **Services** (Lesson 04) to provide stable network addresses.

---

## Concept: Images in Minikube

When Minikube runs a container it pulls images from a registry (Docker Hub by default).
For local development we build images **directly into Minikube's Docker daemon** so we never
need to push to a registry.

Set `imagePullPolicy: Never` in your Pod spec to tell K8s to use the locally cached image.

### Building images with Cloud Native Buildpacks (no Dockerfile needed)

Instead of writing a Dockerfile, Spring Boot 3.x ships with built-in support for
**Cloud Native Buildpacks** via the Maven plugin. Buildpacks analyse your project and
produce a layered, production-ready OCI image automatically.

This is the pattern used for **every service** in this project:

```bash
# Point Docker at Minikube's daemon (once per shell session)
eval $(minikube docker-env)

# Build the image — no Dockerfile required
./mvnw spring-boot:build-image -Dspring-boot.build-image.imageName=shopnow/<service-name>:latest
```

**What Buildpacks give you for free:**
- A JVM sized correctly for the container's memory limits
- CA certificate injection into the JVM truststore
- Security patches without touching your source code
- Layer caching — only changed layers are rebuilt

**One important consequence:** the working directory inside a Buildpacks image is
`/workspace`. When Spring Boot searches for external config files via `file:./config/`,
it resolves to `/workspace/config/` — not `/config/`. Always mount ConfigMaps at
`/workspace/config` in your Deployment. (Covered in Lesson 05.)

---

## Your Task

### 1. Build a Spring Boot image with Buildpacks

You will use this same pattern for every service in the project. You do not need a real
Spring Boot app yet — we will build product-service in Lesson 08. For now, run the command
against config-server (which already exists) to see Buildpacks in action:

```bash
# Point Docker at Minikube's daemon
eval $(minikube docker-env)

# Build — watch Buildpacks detect the Spring Boot project and assemble the image
cd services/config-server
./mvnw spring-boot:build-image -Dspring-boot.build-image.imageName=shopnow/config-server:latest
cd ../..

# Verify the image is now in Minikube's image cache
docker images | grep shopnow
```

> **Note:** The first build downloads Buildpack layers and takes a few minutes.
> Subsequent builds are significantly faster due to layer caching.

### 2. Run a one-off Pod to explore K8s

```bash
# Run an interactive busybox pod (press Ctrl+D to exit)
kubectl run debug --image=busybox:latest --restart=Never -it --rm -n shopnow -- sh

# Inside the pod:
# - What is the hostname?  hostname
# - What is the IP?        ip addr
# - Can you reach Google?  wget -qO- http://example.com
```

### 3. Run a simple nginx Pod and inspect it

```bash
# Create a pod
kubectl run nginx-test --image=nginx:alpine -n shopnow

# Check its status
kubectl get pods -n shopnow
kubectl describe pod nginx-test -n shopnow

# Read its logs
kubectl logs nginx-test -n shopnow

# Execute a command inside it
kubectl exec -it nginx-test -n shopnow -- sh

# Delete it
kubectl delete pod nginx-test -n shopnow
```

### 4. Write your first Pod manifest

Create `k8s/infrastructure/debug-pod.yaml`:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: debug-pod
  namespace: shopnow
  labels:
    app: debug
    part-of: shopnow
spec:
  containers:
    - name: busybox
      image: busybox:latest
      imagePullPolicy: IfNotPresent
      command: ["sleep", "3600"]   # Keep the pod alive for 1 hour
      resources:
        requests:
          memory: "32Mi"
          cpu: "50m"
        limits:
          memory: "64Mi"
          cpu: "100m"
  restartPolicy: Never
```

Apply it, exec into it, then delete it.

---

## Key Pod Fields to Know

```yaml
spec:
  containers:
    - name: my-container           # Name within the pod (used in kubectl exec -c)
      image: my-image:tag          # The container image
      imagePullPolicy: Never       # Never | Always | IfNotPresent
      ports:
        - containerPort: 8080      # Informational only — does NOT publish the port
      env:
        - name: SPRING_PROFILES_ACTIVE
          value: "kubernetes"
      resources:                   # Always set these — covered more in Lesson 10
        requests:
          memory: "256Mi"
          cpu: "250m"
        limits:
          memory: "512Mi"
          cpu: "500m"
```

---

## Notes & Learnings

> _Record anything surprising, problems you hit, or insights you had._

---

## Up Next

[Lesson 03 — Deployments & ReplicaSets](lesson-03-deployments.md)
