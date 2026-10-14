# Architecture: customizable 3D-printed hanger business — hosting foundation

Scope of this document: the **hosting infrastructure only**. The product
configurator, CAD generator, payment integration, and fulfillment automation
are explicitly out of scope and not built.

## Component A — Public website (recommended: GitHub Pages)

**Choice:** GitHub Pages, free plan.

Why:
- $0, no credit card required for the free tier.
- Public HTTPS URL on a free `*.github.io` subdomain; custom domain optional later.
- Serves static HTML/CSS/JS — exactly what the future configurator frontend needs.
- Deployment is `git push`; Pages rebuilds automatically. No build config needed
  for a plain static site (this project publishes the `docs/` folder).
- Free plan publishes from **public** repos only — acceptable here because the
  public site must contain zero secrets anyway (see Security).

Documented free-tier limits (GitHub Docs, corroborated by third-party audits
dated 2026-04 and 2026-08):
- 1 GB published site size.
- ~100 GB/month bandwidth (soft limit — GitHub sends a polite email first).
- 10 builds/hour (soft limit).

Trade-off considered: **Cloudflare Pages** free tier offers unlimited bandwidth
and 500 builds/month, also with no card. GitHub Pages was chosen because the
workflow is simpler (push-to-deploy, no build configuration) and the soft
limits are far above what a placeholder/configurator frontend will use.
Cloudflare Pages remains a valid fallback if bandwidth ever becomes a concern.

**Status: NOT deployed.** Blocked on David creating a GitHub account and a
public repo (see README.md "First-time setup"). No account was created, no
terms accepted, nothing published — per the standing rule.

## Component B — Private CAD-generation backend (recommended: HarePi)

**Choice:** David's Raspberry Pi (HarePi), kept private on the Tailscale network.

**Honest finding:** I could not verify any free hosted backend that reliably
runs OpenSCAD within free-tier constraints. Surveyed:

- **Render (free tier)** — $0, no card required; 512 MB RAM, 750 hrs/month,
  spins down after 15 min of inactivity. Native runtimes support an
  `apt-packages` file for system packages (reported in community deploy guides),
  so OpenSCAD *might* install — but I found no verified example of OpenSCAD
  running headless on Render's free tier, and the sleep/cold-start behavior plus
  512 MB RAM make it unreliable for CAD jobs. Not chosen.
- **Fly.io** — removed its free tier for new customers (Oct 2024); new accounts
  get only a short trial, then a credit card is required (~$2–5/mo minimum).
  Fails the $0 / no-card constraints. Not chosen.
- **Serverless (Vercel/Cloudflare Workers/Lambda)** — cannot run a native
  OpenSCAD binary; architecturally unsuitable. Not chosen.

**Why HarePi wins:**
- David already owns the hardware: $0 marginal cost, no account, no card,
  no sleep policy, no request timeouts, persistent local storage.
- OpenSCAD installs on Raspberry Pi OS via `sudo apt install openscad`
  (documented; works on 32-bit and 64-bit Pi OS).
- HarePi is already on David's Tailscale network (`ssh harepi` works), so the
  backend can stay **entirely off the public internet** — reachable only over
  the tailnet. This satisfies the security requirement by construction: no
  public exposure until authentication, input validation, resource limits, and
  safe file handling are designed.
- OpenSCAD's CLI (`openscad -o part.stl model.scad`) is designed for exactly
  this: headless, scripted STL generation from parametric `.scad` sources.

Nothing was installed on HarePi for this task — investigation only. Installing
OpenSCAD there is a future step for David to approve.

## Manufacturing envelope

- Brief states Slant 3D Teleport max build volume: **220 × 220 × 220 mm**.
  **Not independently verified** — the closest published figure I found is
  Slant 3D's own Mason printer at 220 × 220 × 235 mm (thefabricator.com).
- Design target per brief: **210 × 210 × 210 mm** per part (10 mm margin).
- **Action required:** confirm the 220³ figure against Teleport's current docs
  or a test upload before locking the 210 mm envelope into the generator.

## Security rules (standing)

- Public site (`docs/`) contains: no STL files, no CAD source, no API keys,
  no credentials, no admin endpoints. Nothing to leak even though the repo is public.
- Future CAD backend generates STLs server-side. A customer's browser receives
  only preview imagery/geometry for display — never the production STL, never
  CAD source. Obscure URLs are not treated as protection.
- Backend stays tailnet-only. No public internet exposure until auth, input
  validation, resource limits, and safe file handling are designed and reviewed.
- No arbitrary code execution, unrestricted CAD commands, or unrestricted
  filesystem access from the public site.

## Fulfillment note (out of scope, for later)

2026-10-12 research found Teleport connects directly to Etsy (maps STLs to
listings; prints/packs/ships in 2–3 business days, no upfront fee, charges on
sale) and exposes a public quote/MCP endpoint. Wiring order-triggered STL
generation into Teleport's API is a future step — not designed or tested here.

## Cost assessment

- Component A (GitHub Pages): $0. No charges possible without upgrading.
- Component B (HarePi): $0 marginal (hardware already owned).
- Total: **$0/month**. No paid subscriptions, APIs, or purchases involved.

## Next small implementation step

1. David creates a GitHub account + public repo (README.md has the steps).
2. Push this repo, enable Pages on `/docs`, verify the HTTPS URL.
3. Then, as a separate approved step: `sudo apt install openscad` on HarePi
   and smoke-test headless STL generation (`openscad -o test.stl` on a trivial
   model) before any backend code is written.
