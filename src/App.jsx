import { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const STORAGE_KEY = "ledgerBudgetSettings.v1";
const REQUIRED_HEADERS = ["Date", "Account", "Description", "Category", "Tags", "Amount"];
const starterBudgets = [
  { id: crypto.randomUUID(), name: "Groceries", limit: 500 },
  { id: crypto.randomUUID(), name: "Restaurants", limit: 200 },
];

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const moneyPrecise = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function loadBudgets() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(stored?.budgets)) return stored.budgets;
  } catch {
    // A corrupt local preference should not prevent the private dashboard from opening.
  }
  return starterBudgets;
}

function parseDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseAmount(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[$,\s]/g, "")
    .replace(/^\((.*)\)$/, "-$1");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function periodKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function periodLabel(key) {
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}

function formatAxisMoney(value) {
  if (value >= 1000) return `$${Math.round(value / 1000)}k`;
  return `$${Math.round(value)}`;
}

function App() {
  const [budgets, setBudgets] = useState(loadBudgets);
  const [transactions, setTransactions] = useState([]);
  const [selectedPeriod, setSelectedPeriod] = useState("");
  const [message, setMessage] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const fileInput = useRef(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ budgets }));
  }, [budgets]);

  const periods = useMemo(() => {
    return [...new Set(transactions.map((transaction) => periodKey(transaction.date)))].sort((a, b) => b.localeCompare(a));
  }, [transactions]);

  const visibleTransactions = useMemo(() => {
    if (!selectedPeriod) return [];
    return transactions.filter((transaction) => periodKey(transaction.date) === selectedPeriod);
  }, [selectedPeriod, transactions]);

  const spendingByCategory = useMemo(() => {
    return visibleTransactions.reduce((totals, transaction) => {
      if (transaction.amount >= 0) return totals;
      const category = transaction.category || "Uncategorized";
      totals[category] = (totals[category] || 0) + Math.abs(transaction.amount);
      return totals;
    }, {});
  }, [visibleTransactions]);

  const dashboardRows = useMemo(() => {
    return budgets
      .filter((budget) => budget.name.trim())
      .map((budget) => {
        const spent = spendingByCategory[budget.name.trim()] || 0;
        const limit = Math.max(0, Number(budget.limit) || 0);
        const percent = limit ? (spent / limit) * 100 : 0;
        return { ...budget, name: budget.name.trim(), spent, limit, percent, remaining: limit - spent };
      });
  }, [budgets, spendingByCategory]);

  const summary = useMemo(() => {
    const budgetedSpend = dashboardRows.reduce((total, row) => total + row.spent, 0);
    const budgetTotal = dashboardRows.reduce((total, row) => total + row.limit, 0);
    const allExpenses = Object.values(spendingByCategory).reduce((total, value) => total + value, 0);
    return { budgetedSpend, budgetTotal, allExpenses, remaining: budgetTotal - budgetedSpend };
  }, [dashboardRows, spendingByCategory]);

  function importCsv(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setMessage("Choose a .csv file with the required transaction headers.");
      return;
    }

    setMessage("Reading your file locally…");
    Papa.parse(file, {
      header: true,
      skipEmptyLines: "greedy",
      complete: ({ data, meta, errors }) => {
        const headers = meta.fields?.map((field) => field.trim()) || [];
        const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
        if (missing.length) {
          setMessage(`This CSV is missing: ${missing.join(", ")}. No data was saved.`);
          return;
        }

        const validRows = data
          .map((row, index) => {
            const date = parseDate(row.Date);
            const amount = parseAmount(row.Amount);
            if (!date || amount === null) return null;
            return {
              id: `${index}-${date.getTime()}-${row.Description || "transaction"}`,
              date,
              account: String(row.Account || "").trim(),
              description: String(row.Description || "").trim(),
              category: String(row.Category || "").trim(),
              tags: String(row.Tags || "").trim(),
              amount,
            };
          })
          .filter(Boolean);

        if (!validRows.length) {
          setMessage("No valid Date and Amount rows were found. No data was saved.");
          return;
        }

        const nextPeriods = [...new Set(validRows.map((row) => periodKey(row.date)))].sort((a, b) => b.localeCompare(a));
        setTransactions(validRows);
        setSelectedPeriod(nextPeriods[0]);
        setMessage(`${validRows.length} transactions loaded in memory. Close or refresh this tab to clear them.`);

        if (errors.length) {
          console.warn("CSV import warnings:", errors);
        }
      },
      error: () => setMessage("The CSV could not be read. No data was saved."),
    });
  }

  function updateBudget(id, field, value) {
    setBudgets((current) => current.map((budget) => (budget.id === id ? { ...budget, [field]: value } : budget)));
  }

  function addBudget(name = "", limit = 0) {
    setBudgets((current) => [...current, { id: crypto.randomUUID(), name, limit }]);
  }

  function addImportedCategory() {
    const firstUnbudgeted = Object.keys(spendingByCategory).find(
      (category) => !budgets.some((budget) => budget.name.trim().toLowerCase() === category.toLowerCase()),
    );
    if (firstUnbudgeted) addBudget(firstUnbudgeted, 0);
  }

  const unbudgetedCategories = Object.keys(spendingByCategory).filter(
    (category) => !budgets.some((budget) => budget.name.trim().toLowerCase() === category.toLowerCase()),
  );

  return (
    <main className="app-shell">
      <div className="ambient ambient-gold" />
      <div className="ambient ambient-teal" />
      <section className="app">
        <header className="hero">
          <div>
            <p className="eyebrow">Private budget workspace</p>
            <h1>Know where every<br />dollar is going.</h1>
            <p className="hero-copy">Import a monthly CSV, set category limits, and review your spending without sending a single transaction anywhere.</p>
          </div>
          <div className="privacy-badge"><span className="privacy-lock">⌁</span><span><strong>Browser-only</strong><small>Transactions never leave this tab</small></span></div>
        </header>

        <section className="workspace">
          <aside className="controls" aria-label="Budget controls">
            <div className="panel-heading"><div><p className="eyebrow">Import</p><h2>Monthly activity</h2></div><span className="status-dot" title="Local processing only" /></div>
            <button
              className={`drop-zone ${isDragging ? "is-dragging" : ""}`}
              type="button"
              onClick={() => fileInput.current?.click()}
              onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(event) => { event.preventDefault(); setIsDragging(false); importCsv(event.dataTransfer.files?.[0]); }}
            >
              <span className="upload-icon">↑</span>
              <span><strong>Drop your CSV here</strong><small>or choose a file from this device</small></span>
            </button>
            <input ref={fileInput} className="visually-hidden" type="file" accept=".csv,text/csv" onChange={(event) => importCsv(event.target.files?.[0])} />
            <p className="file-note">Expected columns: Date, Account, Description, Category, Tags, Amount</p>
            {message && <p className="message" role="status">{message}</p>}

            <div className="budget-heading"><div><p className="eyebrow">Configuration</p><h2>Category limits</h2></div><button className="text-button" type="button" onClick={() => addBudget()}>+ Add</button></div>
            <div className="budget-list">
              {budgets.map((budget) => (
                <div className="budget-inputs" key={budget.id}>
                  <input aria-label="Budget category" value={budget.name} placeholder="Category name" onChange={(event) => updateBudget(budget.id, "name", event.target.value)} />
                  <label><span>$</span><input aria-label={`${budget.name || "Category"} monthly limit`} type="number" min="0" step="25" value={budget.limit} onChange={(event) => updateBudget(budget.id, "limit", event.target.value)} /></label>
                  <button className="remove-button" type="button" aria-label={`Remove ${budget.name || "budget"}`} onClick={() => setBudgets((current) => current.filter((entry) => entry.id !== budget.id))}>×</button>
                </div>
              ))}
            </div>
            <p className="save-note">Limits save automatically to this browser only.</p>
          </aside>

          <section className="results" aria-label="Budget dashboard">
            <div className="dashboard-heading">
              <div><p className="eyebrow">Dashboard</p><h2>{selectedPeriod ? periodLabel(selectedPeriod) : "Choose a period to begin"}</h2></div>
              <label className="period-select"> <span className="visually-hidden">Month and year</span><select value={selectedPeriod} onChange={(event) => setSelectedPeriod(event.target.value)} disabled={!periods.length}><option value="">No imported period</option>{periods.map((period) => <option key={period} value={period}>{periodLabel(period)}</option>)}</select></label>
            </div>

            <div className="metric-grid">
              <article className="metric highlight"><span>Budgeted spend</span><strong>{money.format(summary.budgetedSpend)}</strong><small>Across saved categories</small></article>
              <article className="metric"><span>Total limits</span><strong>{money.format(summary.budgetTotal)}</strong><small>For this month</small></article>
              <article className="metric"><span>Remaining</span><strong className={summary.remaining < 0 ? "over" : ""}>{money.format(summary.remaining)}</strong><small>{summary.remaining < 0 ? "Over configured limits" : "Still available"}</small></article>
              <article className="metric"><span>Transactions</span><strong>{visibleTransactions.length}</strong><small>{selectedPeriod ? "In selected period" : "Import a CSV to view"}</small></article>
            </div>

            {!transactions.length ? (
              <section className="empty-state"><span>⌁</span><h3>Your dashboard is ready.</h3><p>Upload a CSV to see private, month-by-month budget progress.</p></section>
            ) : (
              <>
                {unbudgetedCategories.length > 0 && <div className="unbudgeted-note"><span>Unbudgeted spending found in {unbudgetedCategories.length} categor{unbudgetedCategories.length === 1 ? "y" : "ies"}.</span><button type="button" onClick={addImportedCategory}>Add {unbudgetedCategories[0]} as a limit</button></div>}
                <section className="chart-shell">
                  <div className="panel-heading"><div><p className="eyebrow">Limit comparison</p><h2>Spending against plan</h2></div><div className="chart-legend"><span><i className="spent-dot" />Spent</span><span><i className="limit-dot" />Monthly limit</span></div></div>
                  <div className="chart-wrap">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dashboardRows} margin={{ top: 12, right: 10, left: -16, bottom: 4 }} barGap={7}>
                        <CartesianGrid vertical={false} stroke="rgba(231, 215, 168, 0.13)" />
                        <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: "#b8b2a2", fontSize: 12 }} />
                        <YAxis tickLine={false} axisLine={false} tickFormatter={formatAxisMoney} tick={{ fill: "#b8b2a2", fontSize: 12 }} />
                        <Tooltip cursor={{ fill: "rgba(247, 241, 227, 0.05)" }} formatter={(value) => moneyPrecise.format(Number(value))} contentStyle={{ background: "#151b19", border: "1px solid rgba(231, 215, 168, .25)", borderRadius: 8, color: "#f7f1e3" }} />
                        <Bar dataKey="spent" name="Spent" radius={[5, 5, 0, 0]}>{dashboardRows.map((row) => <Cell key={row.id} fill={row.percent > 100 ? "#fb7185" : "#d8b45f"} />)}</Bar>
                        <Bar dataKey="limit" name="Monthly limit" fill="rgba(45, 212, 191, .65)" radius={[5, 5, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>

                <section className="progress-shell">
                  <div className="panel-heading"><div><p className="eyebrow">Category detail</p><h2>Budget health</h2></div><span className="quiet-summary">{money.format(summary.allExpenses)} total expenses</span></div>
                  <div className="progress-list">
                    {dashboardRows.map((row) => <article className="progress-row" key={row.id}><div className="progress-label"><span>{row.name}</span><strong>{moneyPrecise.format(row.spent)} <small>of {money.format(row.limit)}</small></strong></div><div className="progress-track"><div className={`progress-fill ${row.percent > 100 ? "over-limit" : ""}`} style={{ width: `${Math.min(row.percent, 100)}%` }} /></div><p className={row.remaining < 0 ? "over" : ""}>{row.limit ? row.remaining >= 0 ? `${money.format(row.remaining)} remaining` : `${money.format(Math.abs(row.remaining))} over` : "Set a limit"}</p></article>)}
                  </div>
                </section>
              </>
            )}
          </section>
        </section>
      </section>
    </main>
  );
}

export default App;
