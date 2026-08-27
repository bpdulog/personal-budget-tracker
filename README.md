# Ledger — Personal Budget Tracker

A private, static monthly-budget SPA. It is designed for GitHub Pages and has no server or database.

## Privacy model

- CSV rows are parsed in the browser with PapaParse and kept only in React memory.
- Refreshing or closing the tab clears imported transactions.
- Only budget category names and monthly limits are stored in this browser's `localStorage`.
- The app does not make any network requests or include analytics.

## CSV format

The importer expects these headers exactly:

```text
Date,Account,Description,Category,Tags,Amount
```

Expenses are negative values in `Amount`; the dashboard uses their absolute values when calculating category spending. Positive values are treated as non-expense transactions and do not count against a budget.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL Vite prints (normally `http://localhost:5173`).

## Production build

```bash
npm run build
npm run preview
```

The static production files are written to `dist/`.

## Deploy to GitHub Pages

1. Create a public GitHub repository named `personal-budget-tracker`.
2. From this project folder, initialize and push the repository:

   ```bash
   git init -b main
   git add .
   git commit -m "Initial budget tracker"
   git remote add origin https://github.com/YOUR-USERNAME/personal-budget-tracker.git
   git push -u origin main
   ```

3. In GitHub, open **Settings → Pages** and select **GitHub Actions** as the source if it is not automatically selected.

The included workflow builds the site using the `/personal-budget-tracker/` base path and deploys it on every push to `main`.
