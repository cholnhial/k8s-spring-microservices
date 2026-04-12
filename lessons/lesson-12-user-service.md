# Lesson 12 — RBAC & ServiceAccounts: User Service

**Status:** [ ] Complete
**K8s Concepts:** ServiceAccount, Role, RoleBinding, RBAC
**Spring Boot Concepts:** Spring Security, JWT (JJWT), stateless auth filter

---

## Concept: Why Every Pod Has an Identity

Every pod in K8s runs under a **ServiceAccount**. Unless you specify otherwise, pods use
the `default` ServiceAccount of their namespace. The ServiceAccount is not just a label —
it has real consequences:

1. K8s mounts a signed **ServiceAccount token** into every pod at
   `/var/run/secrets/kubernetes.io/serviceaccount/token`
2. When the pod calls the K8s API (e.g., Spring Cloud Kubernetes reading ConfigMaps),
   it presents this token
3. The K8s API server checks the token against RBAC rules to decide what the pod is allowed to do

The `default` ServiceAccount has **no permissions** to the K8s API by default (since K8s 1.24),
but you should still create dedicated ServiceAccounts per service for two reasons:

- **Audit trail** — you can see exactly which workload made which API call
- **Least privilege** — each service gets only the permissions it actually needs;
  a compromised pod can't escalate beyond its own ServiceAccount's grants

---

## Concept: The RBAC Resource Chain

RBAC is controlled by four resource types. You always build the same chain:

```
ServiceAccount  ←── RoleBinding ───► Role
   (who)                               (what)
```

| Resource | Scope | What it defines |
|---|---|---|
| `ServiceAccount` | Namespace | An identity for pods to run as |
| `Role` | Namespace | A set of allowed verbs on K8s resources within one namespace |
| `ClusterRole` | Cluster-wide | Same as Role but applies across all namespaces |
| `RoleBinding` | Namespace | Grants a Role (or ClusterRole) to a ServiceAccount |
| `ClusterRoleBinding` | Cluster-wide | Grants a ClusterRole to a ServiceAccount everywhere |

### ServiceAccount

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: user-service
  namespace: shopnow
  labels:
    app: user-service
    part-of: shopnow
```

### Role

A Role lists the **verbs** allowed on specific **resources** (optionally scoped to named resources):

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: user-service-role
  namespace: shopnow
rules:
  - apiGroups: [""]              # "" = core API group (Pods, Services, Secrets, etc.)
    resources: ["secrets"]
    resourceNames:               # limit to specific named Secrets only
      - "user-db-credentials"
      - "jwt-secret"
    verbs: ["get"]               # read-only; never "list" or "watch" unless required
```

Common verbs: `get`, `list`, `watch`, `create`, `update`, `patch`, `delete`

> **Principle of least privilege:** only grant the verbs and resources your service
> actually uses. `get` on two named Secrets is far safer than `list` on all Secrets.

### RoleBinding

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: user-service-rolebinding
  namespace: shopnow
subjects:
  - kind: ServiceAccount
    name: user-service          # must match ServiceAccount.metadata.name
    namespace: shopnow
roleRef:
  kind: Role
  name: user-service-role       # must match Role.metadata.name
  apiGroup: rbac.authorization.k8s.io
```

### Wiring the ServiceAccount to the Deployment

```yaml
spec:
  template:
    spec:
      serviceAccountName: user-service    # ← this is all it takes
      containers:
        - name: user-service
          ...
```

K8s automatically mounts the ServiceAccount token into the pod. The RBAC rules you
defined now govern what that pod can do when it calls the K8s API.

---

## Concept: Verifying RBAC with `kubectl auth can-i`

```bash
# Can the user-service ServiceAccount get the jwt-secret Secret?
kubectl auth can-i get secret/jwt-secret \
  --as=system:serviceaccount:shopnow:user-service \
  -n shopnow
# yes

# Can it list all secrets?
kubectl auth can-i list secrets \
  --as=system:serviceaccount:shopnow:user-service \
  -n shopnow
# no
```

This is the fastest way to audit your RBAC grants without deploying anything.

---

## Concept: JWT Authentication

user-service issues **JSON Web Tokens** that other services and the api-gateway can
verify without calling user-service again. This is **stateless auth** — the token itself
carries all needed claims.

### JWT Structure

```
header.payload.signature

eyJhbGciOiJIUzI1NiJ9          ← header: algorithm
.eyJzdWIiOiJhbGljZSIsInJvbGUi ← payload: claims
.Xf3kQ7_uHk...                 ← HMAC-SHA256 signature (using JWT_SECRET)
```

**Claims we include:**

| Claim | Value | Purpose |
|---|---|---|
| `sub` | username | Subject — who this token represents |
| `role` | `USER` or `ADMIN` | For authorization decisions downstream |
| `iat` | Unix timestamp | Issued at |
| `exp` | `iat + 1 hour` | Expiry — after this the token is invalid |

The signature is produced with a **shared secret** (`JWT_SECRET`). Any service that
knows the secret can verify a token without calling user-service. This is why the
secret is stored in a K8s Secret and mounted into both user-service and (later) api-gateway.

### Auth Flow

```
Client
  │  POST /api/auth/register { username, email, password }
  ▼
user-service: hash password (BCrypt), save User, return 201

Client
  │  POST /api/auth/login { username, password }
  ▼
user-service: load User, BCrypt.matches(raw, hash), sign JWT, return { token }

Client (with Bearer token)
  │  GET /api/products   Authorization: Bearer <token>
  ▼
api-gateway: verify JWT signature + expiry, forward request if valid
             (calls GET /api/auth/validate?token=... on user-service, or verifies locally)
```

### Spring Security — Stateless Filter Chain

Spring Security processes every request through a chain of filters. For JWT auth, we:

1. **Disable sessions** — `SessionCreationPolicy.STATELESS`
2. **Disable CSRF** — not needed for stateless APIs
3. **Permit** `/api/auth/**` without authentication
4. **Protect** everything else with `authenticated()`
5. **Add** a custom `JwtAuthFilter` (extends `OncePerRequestFilter`) before
   `UsernamePasswordAuthenticationFilter` that reads the `Authorization` header,
   validates the JWT, and sets the `SecurityContext`

```
Request
  │
  ▼ JwtAuthFilter
  │  - extract "Bearer <token>" from Authorization header
  │  - JwtService.validateToken(token)
  │  - if valid: set SecurityContextHolder.getContext().setAuthentication(...)
  │
  ▼ UsernamePasswordAuthenticationFilter (skipped for JWT requests)
  │
  ▼ Authorization check
  │
  ▼ Controller
```

---

## Your Task

> **Before starting:** generate the Spring Boot project at start.spring.io (or hand it
> to Claude with dependencies listed below) and place it in `services/user-service/`.
> The scaffolding will be created once you have the project in place.

### Dependencies required

When generating the project include:

| Dependency | Starter |
|---|---|
| Spring Web | `spring-boot-starter-web` |
| Spring Data JPA | `spring-boot-starter-data-jpa` |
| Spring Boot Actuator | `spring-boot-starter-actuator` |
| Spring Security | `spring-boot-starter-security` |
| Config Client | `spring-cloud-starter-config` |
| Eureka Discovery Client | `spring-cloud-starter-netflix-eureka-client` |
| PostgreSQL Driver | `postgresql` |

Also add these manually to `pom.xml` after generation (not available on start.spring.io):

```xml
<!-- JWT library — jjwt 0.12.x for Jakarta EE compatibility -->
<dependency>
    <groupId>io.jsonwebtoken</groupId>
    <artifactId>jjwt-api</artifactId>
    <version>0.12.6</version>
</dependency>
<dependency>
    <groupId>io.jsonwebtoken</groupId>
    <artifactId>jjwt-impl</artifactId>
    <version>0.12.6</version>
    <scope>runtime</scope>
</dependency>
<dependency>
    <groupId>io.jsonwebtoken</groupId>
    <artifactId>jjwt-jackson</artifactId>
    <version>0.12.6</version>
    <scope>runtime</scope>
</dependency>
```

### 1. Create the RBAC resources

Create `k8s/user-service/serviceaccount.yaml`:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: user-service
  namespace: shopnow
  labels:
    app: user-service
    part-of: shopnow
```

Create `k8s/user-service/role.yaml`:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: user-service-role
  namespace: shopnow
rules:
  - apiGroups: [""]
    resources: ["secrets"]
    resourceNames:
      - "user-db-credentials"
      - "jwt-secret"
    verbs: ["get"]
```

Create `k8s/user-service/rolebinding.yaml`:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: user-service-rolebinding
  namespace: shopnow
subjects:
  - kind: ServiceAccount
    name: user-service
    namespace: shopnow
roleRef:
  kind: Role
  name: user-service-role
  apiGroup: rbac.authorization.k8s.io
```

Apply all three:

```bash
kubectl apply -f k8s/user-service/serviceaccount.yaml
kubectl apply -f k8s/user-service/role.yaml
kubectl apply -f k8s/user-service/rolebinding.yaml

# Verify the grant
kubectl auth can-i get secret/jwt-secret \
  --as=system:serviceaccount:shopnow:user-service -n shopnow
# Expected: yes

kubectl auth can-i list secrets \
  --as=system:serviceaccount:shopnow:user-service -n shopnow
# Expected: no
```

### 2. Implement the User Service

Once the Spring project is in place, scaffold will be provided. The service needs:

#### `Role` enum
```
USER, ADMIN
```

#### `User` entity

| Field | Type | Constraint |
|---|---|---|
| `id` | `Long` | `@Id @GeneratedValue` |
| `username` | `String` | `@Column(unique=true, nullable=false)` |
| `email` | `String` | `@Column(unique=true, nullable=false)` |
| `password` | `String` | BCrypt hashed; never return in responses |
| `role` | `Role` | `@Enumerated(EnumType.STRING)`, default `USER` |

#### `UserRepository`
Extend `JpaRepository<User, Long>`. Add:
```java
Optional<User> findByUsername(String username);
boolean existsByUsername(String username);
boolean existsByEmail(String email);
```

#### DTOs (records)
- `RegisterRequest(String username, String email, String password)`
- `AuthRequest(String username, String password)`
- `AuthResponse(String token)`

#### `JwtService`
Reads `JWT_SECRET` from env (`@Value("${JWT_SECRET}")`). Provides:
- `generateToken(User user)` → signed JWT with `sub`, `role`, `iat`, `exp` (+1h)
- `extractUsername(String token)` → String
- `isTokenValid(String token)` → boolean (checks signature + expiry)

#### `AuthService`
- `register(RegisterRequest)` → check username/email unique, hash password, save, return `AuthResponse`
- `login(AuthRequest)` → load user, `passwordEncoder.matches`, generate token, return `AuthResponse`

#### `JwtAuthFilter` (extends `OncePerRequestFilter`)
- Read `Authorization` header
- Strip `"Bearer "` prefix
- Call `jwtService.isTokenValid(token)`
- If valid: set `UsernamePasswordAuthenticationToken` into `SecurityContextHolder`

#### `SecurityConfig`
```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    // Inject JwtAuthFilter

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        return http
            .csrf(csrf -> csrf.disable())
            .sessionManagement(s -> s.sessionCreationPolicy(STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/auth/**", "/actuator/health").permitAll()
                .anyRequest().authenticated())
            .addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class)
            .build();
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public AuthenticationManager authenticationManager(AuthenticationConfiguration config)
            throws Exception {
        return config.getAuthenticationManager();
    }
}
```

#### `AuthController`

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/api/auth/register` | `RegisterRequest` | `201 AuthResponse` |
| `POST` | `/api/auth/login` | `AuthRequest` | `200 AuthResponse` |
| `GET` | `/api/auth/validate` | `?token=...` (query param) | `200 { valid: true/false }` |

The `/api/auth/validate` endpoint is for api-gateway to call before forwarding a request.

### 3. Add config to your config repo

Add `user-service.yaml` to your `shopnow-config` git repo:

```yaml
server:
  port: 8084

spring:
  datasource:
    url: jdbc:postgresql://postgres-user:5432/userdb
    username: ${POSTGRES_USER}
    password: ${POSTGRES_PASSWORD}
  jpa:
    hibernate:
      ddl-auto: update

eureka:
  client:
    service-url:
      defaultZone: http://discovery-server:8761/eureka

management:
  endpoint:
    health:
      probes:
        enabled: true
  endpoints:
    web:
      exposure:
        include: health
```

### 4. Create Secrets

```bash
# Database credentials
kubectl create secret generic user-db-credentials \
  --from-literal=POSTGRES_DB=userdb \
  --from-literal=POSTGRES_USER=shopnow \
  --from-literal=POSTGRES_PASSWORD=changeme \
  -n shopnow

# JWT signing secret — use a long, random value in production
kubectl create secret generic jwt-secret \
  --from-literal=JWT_SECRET=your-256-bit-secret-here-change-this-in-production \
  -n shopnow

# Apply the postgres StatefulSet
kubectl apply -f k8s/infrastructure/postgres-user.yaml
kubectl apply -f k8s/infrastructure/postgres-user-svc.yaml
```

### 5. Create the Deployment and Service

These will be scaffolded after you provide the Spring project. Key differences from
previous deployments:

- `serviceAccountName: user-service` in the pod spec
- An extra env var for `JWT_SECRET` from the `jwt-secret` Secret

### 6. Build and deploy

```bash
eval $(minikube docker-env)
cd services/user-service
./mvnw spring-boot:build-image -Dspring-boot.build-image.imageName=shopnow/user-service:latest
cd ../..

kubectl apply -f k8s/user-service/
kubectl rollout status deployment/user-service -n shopnow --timeout=120s
```

### 7. Test the auth flow

```bash
kubectl port-forward svc/api-gateway 8080:8080 -n shopnow

# Register
curl -s -X POST http://localhost:8080/api/users/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","email":"alice@example.com","password":"secret"}'

# Login — copy the token from the response
curl -s -X POST http://localhost:8080/api/users/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"secret"}'

# Validate the token
curl -s "http://localhost:8080/api/users/auth/validate?token=<paste-token-here>"

# Call a protected endpoint (products) with the token
curl -s http://localhost:8080/api/products \
  -H "Authorization: Bearer <paste-token-here>"
```

### 8. Inspect the mounted ServiceAccount token

```bash
# Exec into the user-service pod
kubectl exec -it deployment/user-service -n shopnow -- sh

# The token is always here:
cat /var/run/secrets/kubernetes.io/serviceaccount/token

# Decode the JWT (it's a standard JWT — paste into jwt.io)
# You'll see the ServiceAccount name in the payload:
# "kubernetes.io/serviceaccount/service-account.name": "user-service"
```

### 9. Wire the gateway to enforce JWT authentication

Right now the gateway routes all requests blindly. This step adds a servlet `Filter` to
api-gateway that validates the JWT locally using the shared `JWT_SECRET` — no call to
user-service needed, no extra network hop.

#### Why local verification (not calling `/validate`)?

The JWT is signed with HMAC-SHA256 using `JWT_SECRET`. Any service that has the secret
can verify the signature and expiry in microseconds without making a network call.
Calling user-service on every request would add latency and create a runtime dependency
— if user-service is down, **every** request to every service fails.

The trade-off: you cannot invalidate individual tokens before they expire (there is no
centralized revocation check). For a 1-hour expiry window this is acceptable in most
applications.

#### How it works

```
Browser / curl
  │  GET /api/products
  │  Authorization: Bearer <token>
  ▼
api-gateway  ←── JwtGatewayFilter runs first (Order=1)
  │  1. path starts with /api/users/auth/ or /actuator/ ?  → pass through (no token needed)
  │  2. Authorization header present and starts with "Bearer "?  → no → 401
  │  3. HMAC-SHA256 verify + expiry check using JWT_SECRET     → fail → 401
  │  4. all checks pass                                         → forward to product-service
  ▼
product-service
```

#### 9a. Add JJWT to api-gateway's pom.xml

The jjwt dependencies and the broken test starter have already been updated in
`services/api-gateway/pom.xml` — no manual change needed.

#### 9b. The filter

`services/api-gateway/src/main/java/dev/chol/shopnow/api_gateway/filter/JwtGatewayFilter.java`
has been scaffolded. Read through it — the key points:

- `@Order(1)` — runs before any gateway routing
- `PUBLIC_PATHS` — `/api/users/auth/` and `/actuator/` bypass auth
- `isTokenValid()` — recreates the same `SecretKey` as user-service and calls
  `Jwts.parser().verifyWith(key).build().parseSignedClaims(token)`;
  any `JwtException` (bad signature, expired, malformed) returns false
- `sendUnauthorized()` — writes a JSON `{"error":"..."}` body with status 401

> **The secret must match exactly.** The `JWT_SECRET` value in `jwt-secret` is the
> same K8s Secret mounted into both user-service and api-gateway. If they differ,
> the signature verification will always fail.

#### 9c. Mount `jwt-secret` into the api-gateway Deployment

`k8s/api-gateway/deployment.yaml` has been updated to add:

```yaml
env:
  - name: JWT_SECRET
    valueFrom:
      secretKeyRef:
        name: jwt-secret
        key: JWT_SECRET
```

The `jwt-secret` Secret was already created in step 4 of this lesson. No new Secret needed.

#### 9d. Rebuild and redeploy api-gateway

```bash
eval $(minikube docker-env)
cd services/api-gateway
./mvnw spring-boot:build-image -Dspring-boot.build-image.imageName=shopnow/api-gateway:latest
cd ../..

kubectl apply -f k8s/api-gateway/deployment.yaml
kubectl rollout status deployment/api-gateway -n shopnow --timeout=120s
```

#### 9e. Test enforcement

```bash
kubectl port-forward svc/api-gateway 8080:8080 -n shopnow

# Without a token — should now return 401
curl -s http://localhost:8080/api/products
# Expected: {"error":"Missing or invalid Authorization header"}

# Login to get a token
TOKEN=$(curl -s -X POST http://localhost:8080/api/users/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"secret"}' | jq -r '.token')

# With a valid token — should return product list
curl -s http://localhost:8080/api/products \
  -H "Authorization: Bearer $TOKEN"

# With a tampered token — should return 401
curl -s http://localhost:8080/api/products \
  -H "Authorization: Bearer ${TOKEN}tampered"
# Expected: {"error":"Token is invalid or expired"}

# Auth endpoints still public (no token required)
curl -s -X POST http://localhost:8080/api/users/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"secret"}'
# Expected: {"token":"..."}
```

---

## Notes & Learnings

> _Record anything surprising, problems you hit, or insights you had._

---

## Up Next

[Lesson 13 — Redis StatefulSet: Cart Service](lesson-13-cart-service.md)
