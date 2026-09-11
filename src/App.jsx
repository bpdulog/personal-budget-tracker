import { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const STORAGE_KEY = "ledgerBudgetSettings.v1";
const REQUIRED_HEADERS = ["Date", "Account", "Description", "Category", "Tags", "Amount"];
const starterBudgets = [
  { id: crypto.randomUUID(), type: "category", name: "Groceries", limit: 500 },
  { id: crypto.randomUUID(), type: "category", name: "Restaurants", limit: 200 },
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
    if (Array.isArray(stored?.budgets)) {
      return stored.budgets.map((budget) => ({
        ...budget,
        type: budget.type === "vendor" ? "vendor" : "category",
      }));
    }
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

function trendPeriodLabel(key) {
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit" }).format(new Date(year, month - 1, 1));
}

function formatAxisMoney(value) {
  if (value >= 1000) return `$${Math.round(value / 1000)}k`;
  return `$${Math.round(value)}`;
}

function normalizedText(value) {
  return String(value || "").trim().toLowerCase();
}

function App() {
  const [budgets, setBudgets] = useState(loadBudgets);
  const [transactions, setTransactions] = useState([]);
  const [selectedPeriod, setSelectedPeriod] = useState("");
  const [trendCategory, setTrendCategory] = useState("all");
  const [trendStartPeriod, setTrendStartPeriod] = useState("");
  const [trendEndPeriod, setTrendEndPeriod] = useState("");
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

  const trendCategories = useMemo(() => {
    const categories = new Map();
    transactions.forEach((transaction) => {
      if (transaction.amount >= 0) return;
      const name = transaction.category || "Uncategorized";
      const key = normalizedText(name);
      if (!categories.has(key)) categories.set(key, name);
    });
    return [...categories.entries()]
      .map(([key, name]) => ({ key, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [transactions]);

  useEffect(() => {
    if (trendCategory !== "all" && !trendCategories.some((category) => category.key === trendCategory)) {
      setTrendCategory("all");
    }
  }, [trendCategories, trendCategory]);

  const trendData = useMemo(() => {
    const totals = new Map();
    transactions.forEach((transaction) => {
      const key = periodKey(transaction.date);
      if (!totals.has(key)) totals.set(key, { period: key, label: trendPeriodLabel(key), expenses: 0, categories: {} });
      if (transaction.amount >= 0) return;
      const row = totals.get(key);
      const categoryKey = normalizedText(transaction.category || "Uncategorized");
      const expense = Math.abs(transaction.amount);
      row.expenses += expense;
      row.categories[categoryKey] = (row.categories[categoryKey] || 0) + expense;
    });

    return [...totals.values()]
      .sort((a, b) => a.period.localeCompare(b.period))
      .map((row) => ({
        ...row,
        value: trendCategory === "all" ? row.expenses : row.categories[trendCategory] || 0,
      }));
  }, [transactions, trendCategory]);

  const visibleTrendData = useMemo(() => {
    return trendData.filter((row) => {
      const afterStart = !trendStartPeriod || row.period >= trendStartPeriod;
      const beforeEnd = !trendEndPeriod || row.period <= trendEndPeriod;
      return afterStart && beforeEnd;
    });
  }, [trendData, trendEndPeriod, trendStartPeriod]);

  const trendSummary = useMemo(() => {
    const current = visibleTrendData.at(-1)?.value || 0;
    const previous = visibleTrendData.length > 1 ? visibleTrendData.at(-2).value : null;
    const change = previous === null ? null : current - previous;
    const percent = previous ? (change / previous) * 100 : null;
    return { current, previous, change, percent, latestLabel: visibleTrendData.at(-1)?.label || "latest period" };
  }, [visibleTrendData]);

  const selectedTrendName = trendCategory === "all" ? "All expenses" : trendCategories.find((category) => category.key === trendCategory)?.name || "All expenses";

  const spendingByCategory = useMemo(() => {
    return visibleTransactions.reduce((totals, transaction) => {
      if (transaction.amount >= 0) return totals;
      const category = transaction.category || "Uncategorized";
      totals[category] = (totals[category] || 0) + Math.abs(transaction.amount);
      return totals;
    }, {});
  }, [visibleTransactions]);

  const categoryBudgetMap = useMemo(() => {
    return budgets.reduce((map, budget) => {
      const name = String(budget.name || "").trim();
      if ((budget.type || "category") === "category" && name) map[normalizedText(name)] = budget;
      return map;
    }, {});
  }, [budgets]);

  const categoryRows = useMemo(() => {
    const categoryNames = new Map();
    Object.keys(spendingByCategory).forEach((name) => categoryNames.set(normalizedText(name), name));
    budgets
      .filter((budget) => (budget.type || "category") === "category" && String(budget.name || "").trim())
      .forEach((budget) => categoryNames.set(normalizedText(budget.name), budget.name.trim()));

    return [...categoryNames.entries()].map(([categoryKey, name]) => {
      const budget = categoryBudgetMap[categoryKey];
      const spent = Object.entries(spendingByCategory)
        .filter(([category]) => normalizedText(category) === categoryKey)
        .reduce((total, [, value]) => total + value, 0);
      const limit = budget ? Math.max(0, Number(budget.limit) || 0) : null;
      const percent = limit ? (spent / limit) * 100 : 0;
      return {
        id: `category-${categoryKey}`,
        type: "category",
        name,
        spent,
        limit,
        hasBudget: Boolean(budget),
        percent,
        remaining: limit === null ? null : limit - spent,
      };
    });
  }, [budgets, categoryBudgetMap, spendingByCategory]);

  const vendorRows = useMemo(() => {
    return budgets
      .filter((budget) => budget.type === "vendor" && String(budget.name || "").trim())
      .map((budget) => {
        const searchText = normalizedText(budget.name);
        const spent = visibleTransactions.reduce((total, transaction) => {
          if (transaction.amount >= 0 || !normalizedText(transaction.description).includes(searchText)) return total;
          return total + Math.abs(transaction.amount);
        }, 0);
        const limit = Math.max(0, Number(budget.limit) || 0);
        return {
          ...budget,
          id: `vendor-${budget.id}`,
          type: "vendor",
          name: `Vendor: ${budget.name.trim()}`,
          spent,
          limit,
          hasBudget: true,
          percent: limit ? (spent / limit) * 100 : 0,
          remaining: limit - spent,
        };
      });
  }, [budgets, visibleTransactions]);

  const dashboardRows = useMemo(() => [...categoryRows, ...vendorRows], [categoryRows, vendorRows]);

  const cashFlow = useMemo(() => {
    return visibleTransactions.reduce(
      (flow, transaction) => {
        if (transaction.amount >= 0) flow.incoming += transaction.amount;
        else flow.outgoing += Math.abs(transaction.amount);
        return flow;
      },
      { incoming: 0, outgoing: 0 },
    );
  }, [visibleTransactions]);

  const summary = useMemo(() => {
    const vendorMatches = vendorRows.map((row) => normalizedText(row.name.replace(/^Vendor:\s*/i, "")));
    const budgetedSpend = visibleTransactions.reduce((total, transaction) => {
      if (transaction.amount >= 0) return total;
      const categoryKey = normalizedText(transaction.category || "Uncategorized");
      const hasCategoryBudget = Boolean(categoryBudgetMap[categoryKey]);
      const hasVendorBudget = vendorMatches.some((searchText) => normalizedText(transaction.description).includes(searchText));
      return hasCategoryBudget || hasVendorBudget ? total + Math.abs(transaction.amount) : total;
    }, 0);
    const budgetTotal = budgets.reduce((total, budget) => total + (String(budget.name || "").trim() ? Math.max(0, Number(budget.limit) || 0) : 0), 0);
    const allExpenses = Object.values(spendingByCategory).reduce((total, value) => total + value, 0);
    return { budgetedSpend, budgetTotal, allExpenses, remaining: budgetTotal - budgetedSpend };
  }, [budgets, categoryBudgetMap, spendingByCategory, vendorRows, visibleTransactions]);

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
        setTrendStartPeriod("");
        setTrendEndPeriod("");
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

  function addBudget(name = "", limit = 0, type = "category") {
    setBudgets((current) => [...current, { id: crypto.randomUUID(), type, name, limit }]);
  }

  function addImportedCategory() {
    const firstUnbudgeted = categoryRows.find((row) => !row.hasBudget)?.name;
    if (firstUnbudgeted) addBudget(firstUnbudgeted, 0);
  }

  const unbudgetedCategories = categoryRows.filter((row) => !row.hasBudget && row.spent > 0).map((row) => row.name);

  return (
    <main className="app-shell">
      <div className="ambient ambient-gold" />
      <div className="ambient ambient-teal" />
      <section className="app">
        <header className="hero">
          <div>
            <p className="eyebrow">Private budget workspace</p>
            <h1>Know where every<br />dollar is going.</h1>
            <p className="hero-copy">Import a monthly CSV, set category or vendor limits, and review your spending without sending a single transaction anywhere.</p>
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

            <div className="budget-heading"><div><p className="eyebrow">Configuration</p><h2>Budget rules</h2></div><button className="text-button" type="button" onClick={() => addBudget()}>+ Add</button></div>
            <p className="budget-help">Category rules use the imported Category. Vendor rules match anywhere in a transaction Description.</p>
            <div className="budget-list">
              {budgets.map((budget) => (
                <div className="budget-inputs" key={budget.id}>
                  <select aria-label={`${budget.name || "Budget"} rule type`} value={budget.type || "category"} onChange={(event) => updateBudget(budget.id, "type", event.target.value)}>
                    <option value="category">Category</option>
                    <option value="vendor">Vendor</option>
                  </select>
                  <input aria-label={budget.type === "vendor" ? "Vendor search text" : "Budget category"} value={budget.name} placeholder={budget.type === "vendor" ? "e.g. Amazon" : "Category name"} onChange={(event) => updateBudget(budget.id, "name", event.target.value)} />
                  <label><span>$</span><input aria-label={`${budget.name || "Budget"} monthly limit`} type="number" min="0" step="25" value={budget.limit} onChange={(event) => updateBudget(budget.id, "limit", event.target.value)} /></label>
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
              <article className="metric highlight"><span>Budgeted spend</span><strong>{money.format(summary.budgetedSpend)}</strong><small>Across matching rules</small></article>
              <article className="metric"><span>Total limits</span><strong>{money.format(summary.budgetTotal)}</strong><small>For this month</small></article>
              <article className="metric"><span>Remaining</span><strong className={summary.remaining < 0 ? "over" : ""}>{money.format(summary.remaining)}</strong><small>{summary.remaining < 0 ? "Over configured limits" : "Still available"}</small></article>
              <article className="metric"><span>Transactions</span><strong>{visibleTransactions.length}</strong><small>{selectedPeriod ? "In selected period" : "Import a CSV to view"}</small></article>
            </div>

            {!transactions.length ? (
              <section className="empty-state"><span>⌁</span><h3>Your dashboard is ready.</h3><p>Upload a CSV to see private, month-by-month budget progress.</p></section>
            ) : (
              <>
                {unbudgetedCategories.length > 0 && <div className="unbudgeted-note"><span>Unbudgeted spending found in {unbudgetedCategories.length} categor{unbudgetedCategories.length === 1 ? "y" : "ies"}.</span><button type="button" onClick={addImportedCategory}>Add {unbudgetedCategories[0]} as a limit</button></div>}
                <section className="trend-shell">
                  <div className="panel-heading trend-heading">
                    <div><p className="eyebrow">Across imported periods</p><h2>Spending over time</h2><p className="section-copy">See how expenses move month to month, then focus on a single category.</p></div>
                    <div className="trend-controls">
                      <label className="trend-select"><span>Trend</span><select aria-label="Choose a spending trend" value={trendCategory} onChange={(event) => setTrendCategory(event.target.value)}><option value="all">All expenses</option>{trendCategories.map((category) => <option key={category.key} value={category.key}>{category.name}</option>)}</select></label>
                      <label className="trend-select"><span>From</span><select aria-label="Choose the first trend period" value={trendStartPeriod} onChange={(event) => { const nextStart = event.target.value; setTrendStartPeriod(nextStart); if (nextStart && trendEndPeriod && nextStart > trendEndPeriod) setTrendEndPeriod(nextStart); }}><option value="">Earliest period</option>{trendData.map((row) => <option key={`start-${row.period}`} value={row.period}>{periodLabel(row.period)}</option>)}</select></label>
                      <label className="trend-select"><span>To</span><select aria-label="Choose the last trend period" value={trendEndPeriod} onChange={(event) => { const nextEnd = event.target.value; setTrendEndPeriod(nextEnd); if (nextEnd && trendStartPeriod && nextEnd < trendStartPeriod) setTrendStartPeriod(nextEnd); }}><option value="">Latest period</option>{trendData.map((row) => <option key={`end-${row.period}`} value={row.period}>{periodLabel(row.period)}</option>)}</select></label>
                    </div>
                  </div>
                  <div className="trend-summary"><span><strong>{moneyPrecise.format(trendSummary.current)}</strong> {selectedTrendName.toLowerCase()} in {trendSummary.latestLabel}</span>{trendSummary.previous !== null && <span className={trendSummary.change > 0 ? "trend-change up" : "trend-change"}>{trendSummary.change > 0 ? "↑" : trendSummary.change < 0 ? "↓" : "→"} {moneyPrecise.format(Math.abs(trendSummary.change))} {trendSummary.percent === null ? "" : `(${Math.abs(trendSummary.percent).toFixed(0)}%)`} vs. prior period</span>}</div>
                  <div className="trend-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={visibleTrendData} margin={{ top: 12, right: 14, left: -10, bottom: 4 }}>
                        <CartesianGrid vertical={false} stroke="rgba(231, 215, 168, 0.13)" />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#b8b2a2", fontSize: 12 }} minTickGap={22} />
                        <YAxis tickLine={false} axisLine={false} tickFormatter={formatAxisMoney} tick={{ fill: "#b8b2a2", fontSize: 12 }} />
                        <Tooltip cursor={{ stroke: "rgba(45, 212, 191, .35)", strokeWidth: 1 }} formatter={(value) => moneyPrecise.format(Number(value))} labelFormatter={(label) => `${selectedTrendName} · ${label}`} contentStyle={{ background: "#151b19", border: "1px solid rgba(231, 215, 168, .25)", borderRadius: 8, color: "#f7f1e3" }} />
                        <Line type="monotone" dataKey="value" name={selectedTrendName} stroke="#2dd4bf" strokeWidth={3} dot={{ r: 4, fill: "#2dd4bf", stroke: "#0d1110", strokeWidth: 2 }} activeDot={{ r: 6, fill: "#f1e2b8", stroke: "#0d1110", strokeWidth: 2 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </section>
                <section className="cashflow-shell">
                  <div className="panel-heading"><div><p className="eyebrow">Monthly movement</p><h2>Cash flow</h2></div><span className={`quiet-summary ${cashFlow.incoming - cashFlow.outgoing < 0 ? "over" : ""}`}>{moneyPrecise.format(cashFlow.incoming - cashFlow.outgoing)} net</span></div>
                  <div className="cashflow-layout">
                    <div className="cashflow-stats">
                      <div className="cashflow-stat incoming"><span>Money in</span><strong>{moneyPrecise.format(cashFlow.incoming)}</strong><small>Positive transactions</small></div>
                      <div className="cashflow-stat outgoing"><span>Money out</span><strong>{moneyPrecise.format(cashFlow.outgoing)}</strong><small>Expenses and payments</small></div>
                    </div>
                    <div className="cashflow-chart">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={[{ name: "Selected month", incoming: cashFlow.incoming, outgoing: cashFlow.outgoing }]} margin={{ top: 8, right: 12, left: -16, bottom: 4 }} barGap={14}>
                          <CartesianGrid vertical={false} stroke="rgba(231, 215, 168, 0.13)" />
                          <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: "#b8b2a2", fontSize: 12 }} />
                          <YAxis tickLine={false} axisLine={false} tickFormatter={formatAxisMoney} tick={{ fill: "#b8b2a2", fontSize: 12 }} />
                          <Tooltip cursor={{ fill: "rgba(247, 241, 227, 0.05)" }} formatter={(value) => moneyPrecise.format(Number(value))} contentStyle={{ background: "#151b19", border: "1px solid rgba(231, 215, 168, .25)", borderRadius: 8, color: "#f7f1e3" }} />
                          <Bar dataKey="incoming" name="Money in" fill="#2dd4bf" radius={[5, 5, 0, 0]} />
                          <Bar dataKey="outgoing" name="Money out" fill="#d8b45f" radius={[5, 5, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </section>
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
                  <div className="panel-heading"><div><p className="eyebrow">Budget detail</p><h2>Budget health</h2></div><span className="quiet-summary">{money.format(summary.allExpenses)} total expenses</span></div>
                  <div className="progress-list">
                    {dashboardRows.map((row) => <article className="progress-row" key={row.id}><div className="progress-label"><span>{row.name}</span><strong>{moneyPrecise.format(row.spent)} <small>{row.hasBudget ? `of ${money.format(row.limit)}` : "no comparison"}</small></strong></div><div className="progress-track"><div className={`progress-fill ${row.percent > 100 ? "over-limit" : ""}`} style={{ width: `${Math.min(row.percent, 100)}%` }} /></div><p className={row.remaining < 0 ? "over" : ""}>{row.hasBudget ? row.remaining >= 0 ? `${money.format(row.remaining)} remaining` : `${money.format(Math.abs(row.remaining))} over` : "No budget set"}</p></article>)}
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
