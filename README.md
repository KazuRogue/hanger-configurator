# Hanger Configurator — hosting foundation

Minimal static placeholder site for a future customizable 3D-printed
over-the-cabinet / over-the-door hanger configurator. See `ARCHITECTURE.md`
for the full hosting plan (public site + private CAD backend).

## Layout

- `docs/` — the public website. This is the folder GitHub Pages publishes.
  Contains only static HTML/CSS/JS. **Never** put STL files, CAD source,
  API keys, or credentials in here.
- `ARCHITECTURE.md` — architecture, backend decision with evidence,
  security rules, cost assessment, and next steps.
- `README.md` — this file.

## Preview locally

```bash
cd docs && python3 -m http.server 8000
# open http://localhost:8000
```

## Update and redeploy

1. Edit files under `docs/`.
2. Commit: `git add -A && git commit -m "describe the change"`
3. Push: `git push origin main`
4. GitHub Pages rebuilds automatically (usually under a minute).
   Check progress under the repo's **Actions** tab.

## First-time setup (needs David — not done yet)

The site is **not live yet** because it needs a GitHub account and repository,
which only David can create:

1. Create a free GitHub account at https://github.com/signup (no credit card needed).
2. Create a new **public** repository (e.g. `hanger-configurator`).
   GitHub Pages on the free plan only publishes from public repos.
3. In this project directory, point the local repo at it and push:
   ```bash
   git remote add origin https://github.com/<your-username>/hanger-configurator.git
   git push -u origin main
   ```
4. In the repo: **Settings → Pages → Build and deployment** → deploy from the
   `main` branch, `/docs` folder. Save.
5. The site will be live at `https://<your-username>.github.io/hanger-configurator/`
   over HTTPS.

The local git repo was initialized with a placeholder author (`Muse`).
To make future commits yours: `git config user.name "Your Name"`
and `git config user.email "you@example.com"` inside this directory.

## Cost

$0. GitHub Pages is free for public repos with no credit card required.
Limits: 1 GB site size, ~100 GB/month bandwidth (soft), 10 builds/hour (soft).
