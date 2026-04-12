# Lesson 15 — nginx + Angular: Frontend Deployment

**Status:** [ ] Complete
**K8s Concepts:** ConfigMap as volume, Deployment (stateless), Service (ClusterIP + NodePort)
**Spring Boot Concepts:** None — this lesson is Angular + nginx

---

## Concept: ConfigMap as a Volume

You have used ConfigMaps as environment variable sources. They can also be **mounted as
files** inside a container. This is how nginx.conf gets into the pod.

```yaml
volumes:
  - name: nginx-config
    configMap:
      name: nginx-frontend-config   # K8s ConfigMap

containers:
  - name: frontend
    volumeMounts:
      - name: nginx-config
        mountPath: /etc/nginx/nginx.conf
        subPath: nginx.conf          # ← mount only this key, not the whole directory
```

Without `subPath`, K8s mounts the entire ConfigMap as a directory, replacing
`/etc/nginx/` with a directory containing one file per ConfigMap key. `subPath` mounts
just the one key as a file at the specified path.

**The practical benefit:** change the nginx config by updating the ConfigMap and rolling
the Deployment — no image rebuild required.

```bash
kubectl edit configmap nginx-frontend-config -n shopnow
# or
kubectl create configmap nginx-frontend-config --from-file=nginx.conf \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl rollout restart deployment/frontend -n shopnow
```

---

## Concept: nginx as a Reverse Proxy

nginx has two jobs in this setup:

1. **Serve static files** — the compiled Angular app (`dist/`)
2. **Proxy API calls to the api-gateway** — so the browser never has to know the gateway URL

```
Browser
  │
  │  GET /                   → nginx serves index.html
  │  GET /assets/main.js     → nginx serves static file
  │  GET /api/products       → nginx proxy_pass to api-gateway:8080
  │
  ▼
nginx pod
  │
  ├── /                → /usr/share/nginx/html/  (Angular build output)
  └── /api/            → http://api-gateway:8080/api/
```

This eliminates CORS issues — from the browser's perspective, all requests go to the
same origin (the nginx host).

```nginx
server {
    listen 80;

    # Serve Angular app
    root /usr/share/nginx/html;
    index index.html;

    # Angular client-side routing — unknown paths serve index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy all /api/* calls to the api-gateway
    location /api/ {
        proxy_pass http://api-gateway:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

> **`try_files $uri $uri/ /index.html`** is required for Angular routing. If a user
> navigates directly to `http://app/cart`, nginx cannot find a `/cart` file — it falls
> back to `index.html` and Angular's router takes over.

---

## Concept: Multi-Stage Docker Build

The Angular app is compiled at build time. The runtime container only needs nginx —
not Node, npm, or the Angular CLI. A multi-stage build keeps the final image small.

```dockerfile
# Stage 1: build the Angular app
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build -- --configuration production

# Stage 2: runtime image — just nginx + the built assets
FROM nginx:1.27-alpine
COPY --from=builder /app/dist/frontend/browser /usr/share/nginx/html
# nginx.conf comes from a ConfigMap volume mount at runtime — NOT baked in
EXPOSE 80
```

The nginx.conf is **not** in the image. It is mounted from a ConfigMap at runtime.
This means you can update the proxy rules without rebuilding the image.

---

## Your Task

### 1. Generate the Angular app

If you don't have the Angular CLI installed locally, install it once:

```bash
npm install -g @angular/cli@17
```

Generate the app:

```bash
ng new frontend --routing --style=css --standalone
# Choose: CSS, no SSR
mv frontend/frontend/* frontend/
rm -rf frontend/frontend
```

Run it locally to confirm it works:

```bash
cd frontend
npm start
# Open http://localhost:4200
```

For now the app just needs to exist and build. You will add real UI in a later lesson.

### 2. Create the nginx ConfigMap

Create `k8s/frontend/nginx-configmap.yaml`:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: nginx-frontend-config
  namespace: shopnow
  labels:
    app: frontend
    part-of: shopnow
    version: "1.0"
data:
  nginx.conf: |
    events {
      worker_connections 1024;
    }

    http {
      include       /etc/nginx/mime.types;
      default_type  application/octet-stream;
      sendfile      on;

      server {
        listen 80;

        root  /usr/share/nginx/html;
        index index.html;

        location / {
          try_files $uri $uri/ /index.html;
        }

        location /api/ {
          proxy_pass http://api-gateway:8080;
          proxy_set_header Host              $host;
          proxy_set_header X-Real-IP         $remote_addr;
          proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
          proxy_set_header X-Forwarded-Proto $scheme;
        }
      }
    }
```

### 3. Create the Dockerfile

Create `frontend/Dockerfile`:

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build -- --configuration production

FROM nginx:1.27-alpine
COPY --from=builder /app/dist/frontend/browser /usr/share/nginx/html
EXPOSE 80
```

> If `ng build` outputs to `dist/frontend/` (no `browser/` subdirectory), adjust the
> `COPY --from=builder` path accordingly. Check `angular.json` for the `outputPath`.

### 4. Build the image into Minikube

```bash
eval $(minikube docker-env)
docker build -t shopnow/frontend:latest frontend/
```

### 5. Create the Deployment

Create `k8s/frontend/deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
  namespace: shopnow
  labels:
    app: frontend
    part-of: shopnow
    version: "1.0"
spec:
  replicas: 1
  selector:
    matchLabels:
      app: frontend
  template:
    metadata:
      labels:
        app: frontend
        part-of: shopnow
        version: "1.0"
    spec:
      containers:
        - name: frontend
          image: shopnow/frontend:latest
          imagePullPolicy: Never
          ports:
            - containerPort: 80
          volumeMounts:
            - name: nginx-config
              mountPath: /etc/nginx/nginx.conf
              subPath: nginx.conf
          livenessProbe:
            httpGet:
              path: /
              port: 80
            periodSeconds: 15
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /
              port: 80
            periodSeconds: 5
            failureThreshold: 3
          resources:
            requests:
              memory: "64Mi"
              cpu: "50m"
            limits:
              memory: "128Mi"
              cpu: "100m"
      volumes:
        - name: nginx-config
          configMap:
            name: nginx-frontend-config
```

### 6. Create the Service

Create `k8s/frontend/service.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: frontend
  namespace: shopnow
  labels:
    app: frontend
    part-of: shopnow
    version: "1.0"
spec:
  type: NodePort
  selector:
    app: frontend
  ports:
    - port: 80
      targetPort: 80
      nodePort: 30080
```

> **NodePort** exposes the service on every Minikube node's port 30080. This lets you
> open the app directly in the browser without `kubectl port-forward`. The Ingress
> (from Lesson 09) is the production-grade way — NodePort is a shortcut for local dev.

### 7. Deploy

```bash
kubectl apply -f k8s/frontend/nginx-configmap.yaml
kubectl apply -f k8s/frontend/deployment.yaml
kubectl apply -f k8s/frontend/service.yaml

kubectl rollout status deployment/frontend -n shopnow --timeout=60s
```

### 8. Open the app

```bash
minikube service frontend -n shopnow
# Opens the NodePort URL in your default browser
```

Or get the URL manually:

```bash
minikube ip
# e.g. 192.168.49.2
# Open http://192.168.49.2:30080
```

### 9. Test the nginx proxy

With the browser open, verify that `/api/` is being proxied:

```bash
# The browser's network tab should show requests to /api/products returning data
# Or test directly:
NODE_IP=$(minikube ip)
curl -s http://$NODE_IP:30080/api/products | head -c 200
# Expected: JSON product list (via nginx → api-gateway → product-service)
```

### 10. Demonstrate ConfigMap live reload

Change the nginx config (e.g., add a custom response header) and update the app
without rebuilding:

```bash
# Edit the ConfigMap directly
kubectl edit configmap nginx-frontend-config -n shopnow
# Add under server { ... }: add_header X-Served-By "shopnow-frontend";

# Roll the deployment to pick up the new config
kubectl rollout restart deployment/frontend -n shopnow

# Verify the header appears
curl -sI http://$(minikube ip):30080/ | grep X-Served-By
```

---

## Notes & Learnings

> _Record anything surprising, problems you hit, or insights you had._

---

## Up Next

[Lesson 16 — Sidecar Pattern: Distributed Tracing with Zipkin](lesson-16-tracing.md)
