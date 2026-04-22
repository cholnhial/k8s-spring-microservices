# Lesson 19 — Helm Charts: Packaging the Platform

**Status:** [ ] Complete
**K8s Concepts:** Helm chart, templates, values, releases, subcharts, lifecycle hooks
**Spring Boot Concepts:** n/a

---

## Concept: Why Helm?

By the end of Lesson 18 you have roughly 40 YAML files across `k8s/`. Deploying
ShopNow from scratch means `kubectl apply -f` on every directory in the right order,
keeping track of Secrets that must be created imperatively, and editing manifests
by hand when an environment differs.

Problems with raw manifests:

1. **Duplication.** Every service Deployment repeats the same probe, resource, and
   security-context blocks. Changing the probe timing across all services is a
   40-file edit.
2. **No per-environment variance.** Dev uses `imagePullPolicy: Never`; staging uses
   `IfNotPresent` with a registry. There's no clean way to express that with raw
   YAML without duplicating files.
3. **No atomic install / upgrade / rollback.** `kubectl apply` is per-file. A
   half-failed apply leaves the cluster in an unclear state.
4. **No versioning.** "What does the platform look like at v1.3?" has no answer
   other than a git commit hash.

Helm is the K8s package manager. It solves all four by wrapping your manifests in a
**chart**: a templated, versioned, parameterised unit of deployment.

```
        before Helm                              with Helm
  ┌───────────────────────┐              ┌───────────────────────────┐
  │  40 YAML files        │              │  1 chart: shopnow-1.0.0   │
  │  kubectl apply -f *   │              │  helm install shopnow ./  │
  │  hope order is right  │              │  helm upgrade shopnow ./  │
  │  manual env edits     │              │  helm rollback shopnow 2  │
  └───────────────────────┘              └───────────────────────────┘
```

---

## Concept: Chart Structure

A chart is just a directory with a known layout:

```
shopnow/                      ← chart root (name must match Chart.yaml)
├── Chart.yaml                ← metadata: name, version, appVersion
├── values.yaml               ← default configuration values
├── values-dev.yaml           ← overrides for dev (optional, by convention)
├── values-staging.yaml       ← overrides for staging
├── templates/
│   ├── _helpers.tpl          ← reusable template fragments
│   ├── NOTES.txt             ← printed after install
│   ├── namespace.yaml
│   ├── configmap-config-url.yaml
│   ├── api-gateway/
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   └── ingress.yaml
│   ├── order-service/
│   │   ├── deployment.yaml
│   │   └── service.yaml
│   └── ...
└── charts/                   ← subchart dependencies (pulled in via `helm dep update`)
```

### `Chart.yaml`

```yaml
apiVersion: v2
name: shopnow
description: ShopNow microservices platform
type: application
version: 1.0.0                 # chart version — bump when templates change
appVersion: "1.0.0"            # application version — bump when your code changes
```

- `version` = chart semver (this Helm package's version).
- `appVersion` = a human label for the application inside the chart. Defaults to
  `{{ .Chart.AppVersion }}` in image tags if you reference it.

These two are **independent**. You might bump the chart version (say, to fix a
template bug) without changing the app, or vice versa.

### `values.yaml`

Default values consumed by templates:

```yaml
global:
  namespace: shopnow
  imageRegistry: shopnow
  imagePullPolicy: IfNotPresent

orderService:
  enabled: true
  replicas: 2
  image:
    repository: shopnow/order-service
    tag: "1.0.0"
  resources:
    requests:
      cpu: 250m
      memory: 512Mi
    limits:
      cpu: 500m
      memory: 768Mi
```

Anything in `values.yaml` is addressable in templates via `.Values.*`.

---

## Concept: Templating — Go Templates + Sprig

Helm templates use the Go `text/template` engine, extended with the Sprig function
library. At install time Helm walks `templates/`, renders each file, and submits the
result to the API server.

### Variable substitution

```yaml
metadata:
  name: {{ .Values.orderService.name | default "order-service" }}
  namespace: {{ .Values.global.namespace }}
spec:
  replicas: {{ .Values.orderService.replicas }}
```

`.Values` is the merged values tree. `.Chart` and `.Release` are also available:

- `.Release.Name` — name given to the install (e.g. `helm install shopnow-dev ./`)
- `.Release.Namespace` — the namespace Helm was asked to install into
- `.Chart.Name` / `.Chart.Version` / `.Chart.AppVersion` — from Chart.yaml

### Conditionals and loops

```yaml
{{- if .Values.orderService.enabled }}
apiVersion: apps/v1
kind: Deployment
# ... Deployment body
{{- end }}
```

```yaml
env:
  {{- range $key, $val := .Values.orderService.env }}
  - name: {{ $key }}
    value: {{ $val | quote }}
  {{- end }}
```

The `{{-` and `-}}` syntax trims whitespace — without it, rendered YAML becomes a
mess of blank lines.

### Helper templates (`_helpers.tpl`)

Repeated fragments (labels, selectors, image references) are extracted into named
templates:

```gotemplate
{{/* _helpers.tpl */}}
{{- define "shopnow.labels" -}}
app.kubernetes.io/name: {{ .name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
part-of: shopnow
{{- end -}}

{{- define "shopnow.image" -}}
{{ .Values.global.imageRegistry }}/{{ .repo }}:{{ .tag | default .Chart.AppVersion }}
{{- end -}}
```

Invoke with `{{ include "shopnow.labels" (dict "name" "order-service" "Chart" .Chart "Release" .Release) }}`.

Files starting with `_` are not rendered as manifests — they only supply templates
for other files to include.

---

## Concept: Releases & the Helm Lifecycle

A **release** is an install of a chart with a specific name into a specific namespace.
You can install the same chart multiple times with different release names (e.g.
`shopnow-dev` and `shopnow-staging`) — Helm tracks each as a separate release.

```bash
# First install
helm install shopnow ./helm/shopnow -n shopnow --create-namespace

# Change values.yaml or bump a tag, then upgrade
helm upgrade shopnow ./helm/shopnow -n shopnow

# Rollback to the previous release revision
helm rollback shopnow -n shopnow

# Inspect releases
helm list -n shopnow
helm history shopnow -n shopnow
helm get values shopnow -n shopnow         # values used for current release
helm get manifest shopnow -n shopnow       # fully rendered YAML as installed

# Uninstall
helm uninstall shopnow -n shopnow
```

### How Helm tracks releases

Release state is stored in a K8s Secret (one per revision) in the release's namespace:

```bash
kubectl get secrets -n shopnow -l owner=helm
# NAME                          TYPE                 AGE
# sh.helm.release.v1.shopnow.v1 helm.sh/release.v1   5m
# sh.helm.release.v1.shopnow.v2 helm.sh/release.v1   3m
```

Each secret holds a compressed copy of the rendered manifest + values. `helm rollback`
just reinstates an older secret's manifest into the cluster.

### Install / upgrade / rollback hooks

Helm provides lifecycle hooks for resources that should run at specific points:

```yaml
metadata:
  annotations:
    "helm.sh/hook": post-install,post-upgrade
    "helm.sh/hook-weight": "5"
    "helm.sh/hook-delete-policy": hook-succeeded
```

Common uses: a one-shot Job that seeds the database, or a pre-upgrade Job that
validates migration compatibility.

---

## Concept: Subcharts (Dependencies)

A chart can declare dependencies on other charts. This is how you include PostgreSQL,
Redis, Kafka — you don't rewrite them, you pull in Bitnami's (or another vendor's)
charts as subcharts.

### Declaring dependencies

In `Chart.yaml`:

```yaml
dependencies:
  - name: postgresql
    version: 15.5.0
    repository: https://charts.bitnami.com/bitnami
    alias: postgres-product          # install this dep as "postgres-product"
    condition: postgresProduct.enabled
  - name: postgresql
    version: 15.5.0
    repository: https://charts.bitnami.com/bitnami
    alias: postgres-order
    condition: postgresOrder.enabled
  - name: redis
    version: 19.0.0
    repository: https://charts.bitnami.com/bitnami
    condition: redis.enabled
```

Then run:

```bash
helm repo add bitnami https://charts.bitnami.com/bitnami
helm dep update ./helm/shopnow
```

This pulls the tarballs into `./helm/shopnow/charts/`. They're now part of your chart
and travel with it.

### Passing values to a subchart

In `values.yaml`:

```yaml
postgres-product:               # matches the alias
  enabled: true
  auth:
    username: shopnow
    database: productdb
    existingSecret: product-db-credentials    # the Secret you created in Lesson 06
    secretKeys:
      userPasswordKey: POSTGRES_PASSWORD
  primary:
    persistence:
      size: 1Gi

redis:
  enabled: true
  auth:
    enabled: false              # simple setup for learning
  architecture: standalone
```

The top-level key must match either `name` or `alias` in the dependency. Values
inside become `.Values.*` from the subchart's perspective.

### Trade-offs

Pros:
- No maintenance burden — Bitnami keeps their charts current.
- Encodes best practice for operational concerns (backups, metrics, TLS).

Cons:
- The subchart's surface area (its own values schema) becomes part of your
  interface. Upgrades can be breaking.
- In our course, we've been learning *the primitives* — wholesale vendoring
  short-circuits that.

> For this lesson we'll **convert the services we built** (Spring Boot apps) into a
> Helm chart, but **keep the infrastructure** (postgres, redis, kafka) as raw manifests
> you wrote in earlier lessons. A future exercise is to replace each with a Bitnami
> subchart.

---

## Concept: Helm vs Kustomize

Helm isn't the only way to parameterise manifests. **Kustomize** is the built-in
alternative (`kubectl apply -k`). A quick comparison:

| | Helm | Kustomize |
|---|---|---|
| Style | Templating (Go templates) | Overlay (patches + strategic merge) |
| Parameterisation | `values.yaml` + template logic | Base + overlay directories |
| Release tracking | Yes (revisions, rollback) | No (stateless) |
| Dependencies / subcharts | Yes | No (you compose by referencing paths) |
| Logic (ifs, loops) | Yes — templating is Turing-complete | No — declarative only |
| Learning curve | Steeper | Gentler |

They're often combined: Helm for packaging, Kustomize for per-environment tweaks at
apply time. For this course we're using Helm because release tracking + rollback
map cleanly to the operational patterns we've been building toward.

---

## Your Task

### 1. Install Helm

```bash
# Linux
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# Verify
helm version
# Expect: version.BuildInfo{Version:"v3.x.y", ...}
```

### 2. Scaffold the chart

From the project root:

```bash
mkdir -p helm
helm create helm/shopnow
```

This generates a sample chart (Nginx-based). You'll gut most of it. Keep:
- `Chart.yaml`
- `values.yaml` (but wipe its contents)
- `templates/_helpers.tpl` (but wipe its contents)
- `templates/NOTES.txt`

Delete:
- `templates/deployment.yaml`
- `templates/service.yaml`
- `templates/hpa.yaml`
- `templates/ingress.yaml`
- `templates/serviceaccount.yaml`
- `templates/tests/`

You'll replace these with templates derived from your existing manifests.

### 3. Write `Chart.yaml`

```yaml
apiVersion: v2
name: shopnow
description: ShopNow — microservices platform running on Kubernetes
type: application
version: 1.0.0
appVersion: "1.0.0"
maintainers:
  - name: Chol Nhial Chol
    email: chol.nhial.chol@gmail.com
```

### 4. Write `values.yaml`

This is the central control plane for the chart. Start with:

```yaml
global:
  namespace: shopnow
  imageRegistry: shopnow
  imagePullPolicy: Never          # Never for local Minikube builds
  labels:
    partOf: shopnow

# ── Infrastructure config references (secrets are created outside the chart) ──
configServer:
  enabled: true
  replicas: 1
  image:
    repository: shopnow/config-server
    tag: "1.0.0"
  gitRepo: https://github.com/<your-user>/shopnow-config.git   # ← edit

discoveryServer:
  enabled: true
  replicas: 1
  image:
    repository: shopnow/discovery-server
    tag: "1.0.0"

apiGateway:
  enabled: true
  replicas: 2
  image:
    repository: shopnow/api-gateway
    tag: "1.0.0"
  ingressHost: shopnow.local

# ── Business services (pattern: one block per service) ──
orderService:
  enabled: true
  replicas: 2
  image:
    repository: shopnow/order-service
    tag: "1.0.0"
  resources:
    requests: { cpu: 250m, memory: 512Mi }
    limits:   { cpu: 500m, memory: 768Mi }
  hpa:
    enabled: true
    minReplicas: 2
    maxReplicas: 5
    cpuTarget: 60

productService:
  enabled: true
  replicas: 2
  image:
    repository: shopnow/product-service
    tag: "1.0.0"
  resources:
    requests: { cpu: 250m, memory: 512Mi }
    limits:   { cpu: 500m, memory: 768Mi }
  hpa:
    enabled: true
    minReplicas: 2
    maxReplicas: 4
    cpuTarget: 60

inventoryService:
  enabled: true
  replicas: 1
  image:
    repository: shopnow/inventory-service
    tag: "1.0.0"
  resources:
    requests: { cpu: 250m, memory: 512Mi }
    limits:   { cpu: 500m, memory: 768Mi }

userService:
  enabled: true
  replicas: 1
  image:
    repository: shopnow/user-service
    tag: "1.0.0"
  resources:
    requests: { cpu: 250m, memory: 512Mi }
    limits:   { cpu: 500m, memory: 768Mi }

cartService:
  enabled: true
  replicas: 1
  image:
    repository: shopnow/cart-service
    tag: "1.0.0"

notificationService:
  enabled: true
  replicas: 1
  image:
    repository: shopnow/notification-service
    tag: "1.0.0"
```

### 5. Write `_helpers.tpl`

Reusable fragments. Replace the content of `templates/_helpers.tpl` with:

```gotemplate
{{/*
Common labels — invoke with a dict: (include "shopnow.labels" (dict "name" "order-service" "root" .))
*/}}
{{- define "shopnow.labels" -}}
app: {{ .name }}
app.kubernetes.io/name: {{ .name }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/version: {{ .root.Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .root.Release.Service }}
part-of: {{ .root.Values.global.labels.partOf }}
version: {{ .root.Chart.AppVersion | quote }}
{{- end -}}

{{/*
Selector labels — subset of labels that never change for a given resource
*/}}
{{- define "shopnow.selectorLabels" -}}
app: {{ .name }}
{{- end -}}

{{/*
Image reference — invoke with (include "shopnow.image" .Values.orderService.image)
*/}}
{{- define "shopnow.image" -}}
{{ .repository }}:{{ .tag }}
{{- end -}}

{{/*
Standard Spring Boot probes block. Call with (include "shopnow.probes" (dict "port" 8082))
*/}}
{{- define "shopnow.probes" -}}
startupProbe:
  httpGet:
    path: /actuator/health
    port: {{ .port }}
  failureThreshold: 30
  periodSeconds: 10
livenessProbe:
  httpGet:
    path: /actuator/health/liveness
    port: {{ .port }}
  periodSeconds: 10
  failureThreshold: 3
readinessProbe:
  httpGet:
    path: /actuator/health/readiness
    port: {{ .port }}
  periodSeconds: 5
  failureThreshold: 3
{{- end -}}
```

### 6. Write a templated Deployment

Create `templates/order-service/deployment.yaml`. This is the pattern you'll replicate
for every service:

```yaml
{{- if .Values.orderService.enabled }}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
  namespace: {{ .Values.global.namespace }}
  labels:
    {{- include "shopnow.labels" (dict "name" "order-service" "root" .) | nindent 4 }}
spec:
  replicas: {{ .Values.orderService.replicas }}
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      {{- include "shopnow.selectorLabels" (dict "name" "order-service") | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "shopnow.labels" (dict "name" "order-service" "root" .) | nindent 8 }}
    spec:
      terminationGracePeriodSeconds: 40
      containers:
        - name: order-service
          image: {{ include "shopnow.image" .Values.orderService.image }}
          imagePullPolicy: {{ .Values.global.imagePullPolicy }}
          ports:
            - containerPort: 8082
          env:
            - name: POSTGRES_USER
              valueFrom:
                secretKeyRef:
                  name: order-db-credentials
                  key: POSTGRES_USER
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: order-db-credentials
                  key: POSTGRES_PASSWORD
          lifecycle:
            preStop:
              exec:
                command: ["sh", "-c", "sleep 5"]
          {{- include "shopnow.probes" (dict "port" 8082) | nindent 10 }}
          resources:
            {{- toYaml .Values.orderService.resources | nindent 12 }}
{{- end }}
```

Key template mechanics to understand:

| Syntax | What it does |
|---|---|
| `{{- if .Values.X }} … {{- end }}` | Conditionally render the block |
| `{{ .Values.orderService.replicas }}` | Interpolate a value |
| `{{- include "shopnow.labels" (dict …) \| nindent 4 }}` | Include a helper, indent its output 4 spaces, strip leading newline |
| `{{- toYaml .Values.X \| nindent 12 }}` | Render a whole YAML subtree |

### 7. Template the rest of the services

Create `templates/<service>/deployment.yaml` and `templates/<service>/service.yaml`
for every service in the architecture. The Service template is short:

```yaml
{{- if .Values.orderService.enabled }}
apiVersion: v1
kind: Service
metadata:
  name: order-service
  namespace: {{ .Values.global.namespace }}
  labels:
    {{- include "shopnow.labels" (dict "name" "order-service" "root" .) | nindent 4 }}
spec:
  selector:
    {{- include "shopnow.selectorLabels" (dict "name" "order-service") | nindent 4 }}
  ports:
    - port: 8082
      targetPort: 8082
{{- end }}
```

Replicate this pattern for all services you've built (api-gateway, product, order,
inventory, user, cart, notification, config-server, discovery-server).

### 8. Template the HPAs

For services with `hpa.enabled: true`, create `templates/<service>/hpa.yaml`:

```yaml
{{- if and .Values.orderService.enabled .Values.orderService.hpa.enabled }}
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: order-service-hpa
  namespace: {{ .Values.global.namespace }}
  labels:
    {{- include "shopnow.labels" (dict "name" "order-service" "root" .) | nindent 4 }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: order-service
  minReplicas: {{ .Values.orderService.hpa.minReplicas }}
  maxReplicas: {{ .Values.orderService.hpa.maxReplicas }}
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: {{ .Values.orderService.hpa.cpuTarget }}
{{- end }}
```

### 9. NOTES.txt — what the user sees after install

Replace `templates/NOTES.txt` with:

```
ShopNow v{{ .Chart.AppVersion }} installed as release "{{ .Release.Name }}" in namespace "{{ .Release.Namespace }}".

Services enabled:
{{- if .Values.orderService.enabled }}
  - order-service (replicas: {{ .Values.orderService.replicas }})
{{- end }}
{{- if .Values.productService.enabled }}
  - product-service (replicas: {{ .Values.productService.replicas }})
{{- end }}
{{- if .Values.inventoryService.enabled }}
  - inventory-service (replicas: {{ .Values.inventoryService.replicas }})
{{- end }}

Check status:
  kubectl get pods -n {{ .Values.global.namespace }}
  helm status {{ .Release.Name }} -n {{ .Release.Namespace }}

Port-forward the gateway:
  kubectl port-forward svc/api-gateway 8080:8080 -n {{ .Values.global.namespace }}
```

### 10. Render locally and inspect

Before installing anything, render the chart to YAML and read it:

```bash
# Render with default values
helm template shopnow ./helm/shopnow | less

# Render with a specific values file overriding defaults
helm template shopnow ./helm/shopnow -f ./helm/shopnow/values.yaml | less

# Validate against a cluster's API (dry-run)
helm install shopnow ./helm/shopnow --dry-run --debug -n shopnow
```

Fix any template errors before moving on. Common issues:
- Indentation of `nindent` doesn't match the target YAML context
- Missing `{{- end }}` for an `if` block
- `.Values.X` referenced but not defined in `values.yaml`

### 11. Install the chart

With your cluster running, existing raw manifests torn down, and Secrets already
created (the chart does not manage Secrets — that's deliberate, per your convention
from Lesson 05):

```bash
# Tear down any existing raw-manifest deployment
kubectl delete deployment --all -n shopnow
kubectl delete service --all -n shopnow --field-selector metadata.name!=kubernetes

# Leave Secrets, StatefulSets, PVCs, ConfigMaps alone — they're Lesson-06 state

# Install
helm install shopnow ./helm/shopnow -n shopnow

# Watch the rollout
kubectl get pods -n shopnow -w

# Read the NOTES output
helm status shopnow -n shopnow
```

### 12. Upgrade the release

Make a change to test upgrade/rollback. Bump `orderService.replicas` in `values.yaml`
from 2 to 3:

```bash
helm upgrade shopnow ./helm/shopnow -n shopnow

helm history shopnow -n shopnow
# REVISION  STATUS      CHART          APP VERSION  DESCRIPTION
# 1         superseded  shopnow-1.0.0  1.0.0        Install complete
# 2         deployed    shopnow-1.0.0  1.0.0        Upgrade complete

kubectl get pods -n shopnow -l app=order-service
# Should now be 3 pods
```

### 13. Roll back

```bash
helm rollback shopnow 1 -n shopnow

helm history shopnow -n shopnow
# REVISION  STATUS      ...
# 1         superseded
# 2         superseded
# 3         deployed    (same manifest as revision 1)

kubectl get pods -n shopnow -l app=order-service
# Back to 2 pods
```

### 14. Create a dev values overlay

Create `helm/shopnow/values-dev.yaml` with minimum dev-appropriate settings:

```yaml
global:
  imagePullPolicy: Never

orderService:
  replicas: 1
  hpa:
    enabled: false              # don't autoscale in dev

productService:
  replicas: 1
  hpa:
    enabled: false

inventoryService:
  replicas: 1
userService:
  replicas: 1
cartService:
  replicas: 1
notificationService:
  replicas: 1
```

Install with the overlay:

```bash
helm upgrade shopnow ./helm/shopnow -n shopnow -f ./helm/shopnow/values-dev.yaml

# Verify overrides applied
helm get values shopnow -n shopnow
```

### 15. Package and (optionally) publish

Package the chart into a distributable tarball:

```bash
helm package ./helm/shopnow -d ./helm/dist
# Creates ./helm/dist/shopnow-1.0.0.tgz

# Inspect the archive
tar -tzf ./helm/dist/shopnow-1.0.0.tgz | head
```

This tarball is what would be pushed to a chart registry (Artifact Hub, ChartMuseum,
OCI registry). For this course, having the packaged artifact is enough — you now
have a single versioned file that represents the entire platform.

---

## Notes & Learnings

> _Record anything surprising, problems you hit, or insights you had._

---

## Up Next

[Lesson 20 — NetworkPolicy, ResourceQuotas & Hardening](lesson-20-hardening.md)
