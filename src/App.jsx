import { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const STORAGE_KEY = "ledgerBudgetSettings.v1";
const BUDGET_BACKUP_VERSION = 1;
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

function periodRangeLabel(start, end) {
  if (!start && !end) return "All imported periods";
  if (start && end && start === end) return periodLabel(start);
  return `${start ? periodLabel(start) : "Earliest period"} – ${end ? periodLabel(end) : "Latest period"}`;
}

function offsetPeriod(key, monthOffset) {
  const [year, month] = key.split("-").map(Number);
  const date = new Date(year, month - 1 + monthOffset, 1);
  return periodKey(date);
}

function formatAxisMoney(value) {
  if (value >= 1000) return `$${Math.round(value / 1000)}k`;
  return `$${Math.round(value)}`;
}

function formatChartValue(value, mode) {
  return mode === "percent" ? `${Math.round(value)}%` : moneyPrecise.format(Number(value));
}

function normalizedText(value) {
  return String(value || "").trim().toLowerCase();
}

function App() {
  const [budgets, setBudgets] = useState(loadBudgets);
  const [transactions, setTransactions] = useState([]);
  const [selectedPeriod, setSelectedPeriod] = useState("");
  const [mtdDay, setMtdDay] = useState(() => String(new Date().getDate()));
  const [comparisonMode, setComparisonMode] = useState("percent");
  const [trendCategory, setTrendCategory] = useState("all");
  const [trendStartPeriod, setTrendStartPeriod] = useState("");
  const [trendEndPeriod, setTrendEndPeriod] = useState("");
  const [detailCategory, setDetailCategory] = useState("");
  const [incomeStartPeriod, setIncomeStartPeriod] = useState("");
  const [incomeEndPeriod, setIncomeEndPeriod] = useState("");
  const [showIncomeDetails, setShowIncomeDetails] = useState(false);
  const [incomeDetailView, setIncomeDetailView] = useState("summary");
  const [incomeSourceFilter, setIncomeSourceFilter] = useState("all");
  const [message, setMessage] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const fileInput = useRef(null);
  const budgetFileInput = useRef(null);

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
    const average = visibleTrendData.length ? visibleTrendData.reduce((total, row) => total + row.value, 0) / visibleTrendData.length : 0;
    return { current, previous, change, percent, average, latestLabel: visibleTrendData.at(-1)?.label || "latest period" };
  }, [visibleTrendData]);

  const selectedTrendName = trendCategory === "all" ? "All expenses" : trendCategories.find((category) => category.key === trendCategory)?.name || "All expenses";

  const detailTransactions = useMemo(() => {
    if (!detailCategory) return [];
    return transactions
      .filter((transaction) => {
        if (transaction.amount >= 0 || normalizedText(transaction.category || "Uncategorized") !== detailCategory) return false;
        const period = periodKey(transaction.date);
        return (!trendStartPeriod || period >= trendStartPeriod) && (!trendEndPeriod || period <= trendEndPeriod);
      })
      .sort((a, b) => b.date - a.date);
  }, [detailCategory, transactions, trendEndPeriod, trendStartPeriod]);

  const detailVendors = useMemo(() => {
    const vendors = new Map();
    detailTransactions.forEach((transaction) => {
      const name = transaction.description || "Unknown vendor";
      const key = normalizedText(name) || "unknown vendor";
      const current = vendors.get(key) || { key, name, amount: 0, count: 0 };
      current.amount += Math.abs(transaction.amount);
      current.count += 1;
      vendors.set(key, current);
    });
    return [...vendors.values()].sort((a, b) => b.amount - a.amount);
  }, [detailTransactions]);

  const detailSummary = useMemo(() => {
    const total = detailTransactions.reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);
    return {
      total,
      count: detailTransactions.length,
      vendorCount: detailVendors.length,
      average: detailTransactions.length ? total / detailTransactions.length : 0,
    };
  }, [detailTransactions, detailVendors]);

  const selectedDetailName = trendCategories.find((category) => category.key === detailCategory)?.name || "Selected category";
  const detailRange = periodRangeLabel(trendStartPeriod, trendEndPeriod);

  const incomeData = useMemo(() => {
    const totals = new Map();
    transactions.forEach((transaction) => {
      const key = periodKey(transaction.date);
      if (!totals.has(key)) totals.set(key, { period: key, label: trendPeriodLabel(key), income: 0 });
      if (transaction.amount > 0) totals.get(key).income += transaction.amount;
    });
    return [...totals.values()]
      .sort((a, b) => a.period.localeCompare(b.period))
      .map((row) => ({ ...row, value: row.income }));
  }, [transactions]);

  const visibleIncomeData = useMemo(() => {
    return incomeData.filter((row) => {
      const afterStart = !incomeStartPeriod || row.period >= incomeStartPeriod;
      const beforeEnd = !incomeEndPeriod || row.period <= incomeEndPeriod;
      return afterStart && beforeEnd;
    });
  }, [incomeData, incomeEndPeriod, incomeStartPeriod]);

  const incomeTransactions = useMemo(() => {
    return transactions
      .filter((transaction) => {
        if (transaction.amount <= 0) return false;
        const period = periodKey(transaction.date);
        return (!incomeStartPeriod || period >= incomeStartPeriod) && (!incomeEndPeriod || period <= incomeEndPeriod);
      })
      .sort((a, b) => b.date - a.date);
  }, [incomeEndPeriod, incomeStartPeriod, transactions]);

  const incomeSources = useMemo(() => {
    const sources = new Map();
    incomeTransactions.forEach((transaction) => {
      const name = transaction.description || "Unknown source";
      const key = normalizedText(name) || "unknown source";
      const current = sources.get(key) || { key, name, amount: 0, count: 0 };
      current.amount += transaction.amount;
      current.count += 1;
      sources.set(key, current);
    });
    return [...sources.values()].sort((a, b) => b.amount - a.amount);
  }, [incomeTransactions]);

  const incomeSummary = useMemo(() => {
    const total = incomeTransactions.reduce((sum, transaction) => sum + transaction.amount, 0);
    return {
      total,
      count: incomeTransactions.length,
      sourceCount: incomeSources.length,
      average: incomeTransactions.length ? total / incomeTransactions.length : 0,
      periodAverage: visibleIncomeData.length ? visibleIncomeData.reduce((sum, row) => sum + row.value, 0) / visibleIncomeData.length : 0,
      latestLabel: visibleIncomeData.at(-1)?.label || "latest period",
    };
  }, [incomeSources, incomeTransactions, visibleIncomeData]);

  const incomeDetailTransactions = useMemo(() => {
    if (incomeSourceFilter === "all") return incomeTransactions;
    return incomeTransactions.filter((transaction) => normalizedText(transaction.description || "Unknown source") === incomeSourceFilter);
  }, [incomeSourceFilter, incomeTransactions]);

  const incomeDetailSources = useMemo(() => {
    if (incomeSourceFilter === "all") return incomeSources;
    return incomeSources.filter((source) => source.key === incomeSourceFilter);
  }, [incomeSourceFilter, incomeSources]);

  const incomeDetailSummary = useMemo(() => {
    const total = incomeDetailTransactions.reduce((sum, transaction) => sum + transaction.amount, 0);
    return {
      total,
      count: incomeDetailTransactions.length,
      sourceCount: incomeDetailSources.length,
      average: incomeDetailTransactions.length ? total / incomeDetailTransactions.length : 0,
    };
  }, [incomeDetailSources, incomeDetailTransactions]);

  const incomeRange = periodRangeLabel(incomeStartPeriod, incomeEndPeriod);

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

  const comparisonChartRows = useMemo(() => {
    return dashboardRows.map((row) => ({
      ...row,
      rawChartSpent: comparisonMode === "percent" ? row.hasBudget ? row.percent : null : row.spent,
      chartSpent: comparisonMode === "percent" ? row.hasBudget ? Math.min(row.percent, 200) : null : row.spent,
      chartLimit: comparisonMode === "percent" ? row.hasBudget ? 100 : null : row.limit,
    }));
  }, [comparisonMode, dashboardRows]);

  const comparisonAverage = useMemo(() => {
    const values = comparisonChartRows.map((row) => row.chartSpent).filter((value) => value !== null && Number.isFinite(value));
    return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
  }, [comparisonChartRows]);

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

  const mtdComparison = useMemo(() => {
    const day = Number(mtdDay) || 1;
    if (!selectedPeriod) return { day, rows: [], average: 0 };

    const periodKeys = [selectedPeriod, offsetPeriod(selectedPeriod, -1), offsetPeriod(selectedPeriod, -12)];
    const roles = ["Selected month", "Prior month", "Same month last year"];
    const rows = periodKeys.map((period, index) => {
      const periodTransactions = transactions.filter((transaction) => periodKey(transaction.date) === period);
      const expenseTransactions = periodTransactions.filter((transaction) => transaction.amount < 0 && transaction.date.getDate() <= day);
      const amount = expenseTransactions.reduce((total, transaction) => total + Math.abs(transaction.amount), 0);
      return {
        period,
        role: roles[index],
        label: periodLabel(period),
        chartLabel: index === 0 ? "Selected month" : index === 1 ? "Prior month" : "Prior year",
        amount,
        count: expenseTransactions.length,
        available: periodTransactions.length > 0,
      };
    });
    const currentAmount = rows[0]?.amount || 0;
    const comparisonRows = rows.map((row, index) => ({
      ...row,
      delta: index === 0 || !row.available ? null : currentAmount - row.amount,
      percent: index === 0 || !row.available || !row.amount ? null : ((currentAmount - row.amount) / row.amount) * 100,
    }));
    const availableRows = comparisonRows.filter((row) => row.available);
    const average = availableRows.length ? availableRows.reduce((total, row) => total + row.amount, 0) / availableRows.length : 0;
    return { day, rows: comparisonRows, average, chartRows: availableRows };
  }, [mtdDay, selectedPeriod, transactions]);

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
        setDetailCategory("");
        setIncomeStartPeriod("");
        setIncomeEndPeriod("");
        setShowIncomeDetails(false);
        setIncomeDetailView("summary");
        setIncomeSourceFilter("all");
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

  function exportBudgets() {
    const backup = {
      format: "personal-budget-tracker-budgets",
      version: BUDGET_BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      budgets: budgets.map(({ type, name, limit }) => ({ type: type === "vendor" ? "vendor" : "category", name, limit })),
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `budget-limits-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setMessage(`${budgets.length} budget rule${budgets.length === 1 ? "" : "s"} exported. Keep the JSON file somewhere safe.`);
  }

  async function importBudgets(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".json")) {
      setMessage("Choose a .json budget backup file.");
      return;
    }

    setMessage("Reading your budget backup locallyâ€¦");
    try {
      const backup = JSON.parse(await file.text());
      if (backup?.format !== "personal-budget-tracker-budgets" || backup.version !== BUDGET_BACKUP_VERSION || !Array.isArray(backup.budgets)) {
        throw new Error("unsupported format");
      }

      const restoredBudgets = backup.budgets.map((budget) => {
        if (!budget || typeof budget !== "object") throw new Error("invalid rule");
        const limit = Number(budget.limit);
        if (typeof budget.name !== "string" || !Number.isFinite(limit) || limit < 0 || (budget.type !== "category" && budget.type !== "vendor")) {
          throw new Error("invalid rule");
        }
        return {
          id: crypto.randomUUID(),
          type: budget.type,
          name: budget.name,
          limit,
        };
      });

      setBudgets(restoredBudgets);
      setMessage(`${restoredBudgets.length} budget rule${restoredBudgets.length === 1 ? "" : "s"} imported and saved to this browser.`);
    } catch {
      setMessage("That budget backup could not be read. No limits were changed.");
    }
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
            <div className="budget-backup">
              <div className="budget-backup-heading"><strong>Move to another computer</strong><span>JSON backup</span></div>
              <div className="budget-backup-actions">
                <button className="backup-button" type="button" onClick={exportBudgets}>Export limits</button>
                <button className="backup-button" type="button" onClick={() => budgetFileInput.current?.click()}>Import limits</button>
              </div>
              <input ref={budgetFileInput} className="visually-hidden" type="file" accept=".json,application/json" onChange={(event) => { importBudgets(event.target.files?.[0]); event.target.value = ""; }} />
              <p className="save-note">Export a JSON file, then import it on the other computer. Transactions still need to be uploaded again.</p>
            </div>
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
              <>
                <section className="empty-state"><span>⌁</span><h3>Your dashboard is ready.</h3><p>Upload a CSV to see private, month-by-month budget progress.</p></section>
                <section className="category-detail-shell category-detail-disabled">
                  <div className="panel-heading category-detail-heading">
                    <div><p className="eyebrow">Category explorer</p><h2>Drill into a category</h2><p className="section-copy">Review vendors and individual transactions by category after importing your activity.</p></div>
                    <label className="trend-select"><span>Category</span><select aria-label="Choose a category to inspect" disabled><option>Import a CSV first</option></select></label>
                  </div>
                  <div className="detail-empty"><strong>Upload a CSV to unlock category details.</strong><span>Counts, totals, vendor groupings, and matching transactions will appear here.</span></div>
                </section>
                <section className="mtd-shell mtd-disabled">
                  <div className="panel-heading mtd-heading">
                    <div><p className="eyebrow">Month-to-date comparison</p><h2>How spending is pacing</h2><p className="section-copy">Choose a cutoff day to compare the selected month with the prior month and prior year.</p></div>
                    <label className="trend-select mtd-day-select"><span>Through day</span><select aria-label="Choose the month-to-date cutoff day" disabled><option>Import a CSV first</option></select></label>
                  </div>
                  <div className="detail-empty"><strong>Upload a CSV to unlock MTD spending comparisons.</strong><span>Missing comparison periods will be marked unavailable rather than counted as zero.</span></div>
                </section>
                <section className="income-shell income-disabled">
                  <div className="panel-heading income-heading">
                    <div><p className="eyebrow">Incoming money</p><h2>Income over time</h2><p className="section-copy">Track deposits across imported periods and see which sources make up your incoming money.</p></div>
                    <div className="income-controls"><label className="trend-select"><span>From</span><select aria-label="Choose the first income period" disabled><option>Import a CSV first</option></select></label><label className="trend-select"><span>To</span><select aria-label="Choose the last income period" disabled><option>Import a CSV first</option></select></label></div>
                  </div>
                  <div className="detail-empty"><strong>Upload a CSV to unlock income trends.</strong><span>Incoming totals, date ranges, source groupings, and deposit details will appear here.</span></div>
                </section>
              </>
            ) : (
              <>
                {unbudgetedCategories.length > 0 && <div className="unbudgeted-note"><span>Unbudgeted spending found in {unbudgetedCategories.length} categor{unbudgetedCategories.length === 1 ? "y" : "ies"}.</span><button type="button" onClick={addImportedCategory}>Add {unbudgetedCategories[0]} as a limit</button></div>}
                <section className="mtd-shell">
                  <div className="panel-heading mtd-heading">
                    <div><p className="eyebrow">Month-to-date comparison</p><h2>How spending is pacing</h2><p className="section-copy">Compare the selected month through one cutoff day with the prior month and the same month last year.</p></div>
                    <label className="trend-select mtd-day-select"><span>Through day</span><select aria-label="Choose the month-to-date cutoff day" value={mtdDay} onChange={(event) => setMtdDay(event.target.value)}>{Array.from({ length: 31 }, (_, index) => index + 1).map((day) => <option key={day} value={day}>{day}</option>)}</select></label>
                  </div>
                  <div className="mtd-cards">{mtdComparison.rows.map((row, index) => <article className={`mtd-card ${!row.available ? "is-unavailable" : ""}`} key={row.period}><span>{row.role}</span><strong>{row.available ? moneyPrecise.format(row.amount) : "Not available"}</strong><small>{row.available ? `${row.count} expense${row.count === 1 ? "" : "s"} through day ${mtdComparison.day}` : "Not imported in this CSV"}</small>{index > 0 && <p className={row.delta > 0 ? "mtd-higher" : row.delta < 0 ? "mtd-lower" : ""}>{!row.available ? "No comparison data" : row.delta === 0 ? "Same as selected month" : `Current is ${moneyPrecise.format(Math.abs(row.delta))} ${row.delta > 0 ? "higher" : "lower"}${row.percent === null ? "" : ` (${Math.abs(row.percent).toFixed(0)}%)`}`}</p>}</article>)}</div>
                  <div className="mtd-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={mtdComparison.chartRows} margin={{ top: 14, right: 14, left: -10, bottom: 4 }}>
                        <CartesianGrid vertical={false} stroke="rgba(231, 215, 168, 0.13)" />
                        <XAxis dataKey="chartLabel" tickLine={false} axisLine={false} tick={{ fill: "#b8b2a2", fontSize: 12 }} />
                        <YAxis tickLine={false} axisLine={false} tickFormatter={formatAxisMoney} tick={{ fill: "#b8b2a2", fontSize: 12 }} />
                        <ReferenceLine y={mtdComparison.average} stroke="#f1e2b8" strokeDasharray="5 5" label={{ value: `Avg ${moneyPrecise.format(mtdComparison.average)}`, fill: "#f1e2b8", fontSize: 11, position: "insideTopRight" }} />
                        <Tooltip cursor={{ fill: "rgba(247, 241, 227, 0.05)" }} formatter={(value) => moneyPrecise.format(Number(value))} labelFormatter={(label) => `${label} · through day ${mtdComparison.day}`} contentStyle={{ background: "#151b19", border: "1px solid rgba(231, 215, 168, .25)", borderRadius: 8, color: "#f7f1e3" }} />
                        <Bar dataKey="amount" name="Expenses" radius={[5, 5, 0, 0]}>{mtdComparison.chartRows.map((row, index) => <Cell key={row.period} fill={index === 0 ? "#2dd4bf" : index === 1 ? "#d8b45f" : "#b98d36"} />)}</Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="mtd-note">A comparison is shown only when that period exists in the imported data. Missing periods are not treated as $0.</p>
                </section>
                <section className="trend-shell">
                  <div className="panel-heading trend-heading">
                    <div><p className="eyebrow">Across imported periods</p><h2>Spending over time</h2><p className="section-copy">See how expenses move month to month, then focus on a single category.</p></div>
                    <div className="trend-controls">
                      <label className="trend-select"><span>Trend</span><select aria-label="Choose a spending trend" value={trendCategory} onChange={(event) => setTrendCategory(event.target.value)}><option value="all">All expenses</option>{trendCategories.map((category) => <option key={category.key} value={category.key}>{category.name}</option>)}</select></label>
                      <label className="trend-select"><span>From</span><select aria-label="Choose the first trend period" value={trendStartPeriod} onChange={(event) => { const nextStart = event.target.value; setTrendStartPeriod(nextStart); if (nextStart && trendEndPeriod && nextStart > trendEndPeriod) setTrendEndPeriod(nextStart); }}><option value="">Earliest period</option>{trendData.map((row) => <option key={`start-${row.period}`} value={row.period}>{periodLabel(row.period)}</option>)}</select></label>
                      <label className="trend-select"><span>To</span><select aria-label="Choose the last trend period" value={trendEndPeriod} onChange={(event) => { const nextEnd = event.target.value; setTrendEndPeriod(nextEnd); if (nextEnd && trendStartPeriod && nextEnd < trendStartPeriod) setTrendStartPeriod(nextEnd); }}><option value="">Latest period</option>{trendData.map((row) => <option key={`end-${row.period}`} value={row.period}>{periodLabel(row.period)}</option>)}</select></label>
                    </div>
                  </div>
                  <div className="trend-summary"><span><strong>{moneyPrecise.format(trendSummary.current)}</strong> {selectedTrendName.toLowerCase()} in {trendSummary.latestLabel}</span>{trendSummary.previous !== null && <span className={trendSummary.change > 0 ? "trend-change up" : "trend-change"}>{trendSummary.change > 0 ? "↑" : trendSummary.change < 0 ? "↓" : "→"} {moneyPrecise.format(Math.abs(trendSummary.change))} {trendSummary.percent === null ? "" : `(${Math.abs(trendSummary.percent).toFixed(0)}%)`} vs. prior period</span>}<span className="average-summary">Average {moneyPrecise.format(trendSummary.average)} per period</span></div>
                  <div className="trend-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={visibleTrendData} margin={{ top: 12, right: 14, left: -10, bottom: 4 }}>
                        <CartesianGrid vertical={false} stroke="rgba(231, 215, 168, 0.13)" />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#b8b2a2", fontSize: 12 }} minTickGap={22} />
                        <YAxis tickLine={false} axisLine={false} tickFormatter={formatAxisMoney} tick={{ fill: "#b8b2a2", fontSize: 12 }} />
                        <ReferenceLine y={trendSummary.average} stroke="#f1e2b8" strokeDasharray="5 5" label={{ value: `Avg ${moneyPrecise.format(trendSummary.average)}`, fill: "#f1e2b8", fontSize: 11, position: "insideTopRight" }} />
                        <Tooltip cursor={{ stroke: "rgba(45, 212, 191, .35)", strokeWidth: 1 }} formatter={(value) => moneyPrecise.format(Number(value))} labelFormatter={(label) => `${selectedTrendName} · ${label}`} contentStyle={{ background: "#151b19", border: "1px solid rgba(231, 215, 168, .25)", borderRadius: 8, color: "#f7f1e3" }} />
                        <Line type="monotone" dataKey="value" name={selectedTrendName} stroke="#2dd4bf" strokeWidth={3} dot={{ r: 4, fill: "#2dd4bf", stroke: "#0d1110", strokeWidth: 2 }} activeDot={{ r: 6, fill: "#f1e2b8", stroke: "#0d1110", strokeWidth: 2 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </section>
                <section className="category-detail-shell">
                  <div className="panel-heading category-detail-heading">
                    <div><p className="eyebrow">Category explorer</p><h2>Drill into a category</h2><p className="section-copy">Review vendors and individual transactions in the selected range. Vendors are grouped from the imported Description field.</p></div>
                    <label className="trend-select"><span>Category</span><select aria-label="Choose a category to inspect" value={detailCategory} onChange={(event) => setDetailCategory(event.target.value)}><option value="">Choose a category</option>{trendCategories.map((category) => <option key={`detail-${category.key}`} value={category.key}>{category.name}</option>)}</select></label>
                  </div>
                  {!detailCategory ? (
                    <div className="detail-empty"><strong>Choose a category to see the details.</strong><span>Counts, totals, vendor groupings, and matching transactions will appear here.</span></div>
                  ) : !detailTransactions.length ? (
                    <div className="detail-empty"><strong>No matching transactions in this range.</strong><span>Try widening the trend date range or choosing another category.</span></div>
                  ) : (
                    <>
                      <div className="detail-context"><span><strong>{selectedDetailName}</strong> · {detailRange}</span><span>{detailSummary.count} transaction{detailSummary.count === 1 ? "" : "s"} across {detailSummary.vendorCount} vendor{detailSummary.vendorCount === 1 ? "" : "s"}</span></div>
                      <div className="detail-metrics">
                        <article className="detail-metric"><span>Total spend</span><strong>{moneyPrecise.format(detailSummary.total)}</strong></article>
                        <article className="detail-metric"><span>Transactions</span><strong>{detailSummary.count}</strong></article>
                        <article className="detail-metric"><span>Vendors</span><strong>{detailSummary.vendorCount}</strong></article>
                        <article className="detail-metric"><span>Average transaction</span><strong>{moneyPrecise.format(detailSummary.average)}</strong></article>
                      </div>
                      <div className="detail-grid">
                        <div className="vendor-breakdown">
                          <div className="detail-subheading"><div><p className="eyebrow">Grouped by description</p><h3>Vendors</h3></div><span>{detailVendors.length} total</span></div>
                          <div className="vendor-list">{detailVendors.map((vendor) => <div className="vendor-row" key={vendor.key}><div className="vendor-row-label"><span>{vendor.name}</span><strong>{moneyPrecise.format(vendor.amount)}</strong></div><div className="vendor-row-meta"><span>{vendor.count} transaction{vendor.count === 1 ? "" : "s"}</span><span>{detailSummary.total ? `${((vendor.amount / detailSummary.total) * 100).toFixed(0)}%` : "0%"}</span></div><div className="vendor-track"><div style={{ width: `${detailSummary.total ? (vendor.amount / detailSummary.total) * 100 : 0}%` }} /></div></div>)}</div>
                        </div>
                        <div className="transaction-breakdown">
                          <div className="detail-subheading"><div><p className="eyebrow">Every matching row</p><h3>Transactions</h3></div><span>{detailSummary.count} total</span></div>
                          <div className="transaction-table-wrap"><table className="transaction-table"><thead><tr><th>Date</th><th>Description</th><th>Account</th><th>Amount</th></tr></thead><tbody>{detailTransactions.map((transaction) => <tr key={transaction.id}><td>{transaction.date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td><td><strong>{transaction.description || "Unknown description"}</strong>{transaction.tags && <small>{transaction.tags}</small>}</td><td>{transaction.account || "—"}</td><td>{moneyPrecise.format(Math.abs(transaction.amount))}</td></tr>)}</tbody></table></div>
                        </div>
                      </div>
                    </>
                  )}
                </section>
                <section className="income-shell">
                  <div className="panel-heading income-heading">
                    <div><p className="eyebrow">Incoming money</p><h2>Income over time</h2><p className="section-copy">Track deposits across imported periods, choose a date range, and see which sources make up your incoming money.</p></div>
                    <div className="income-controls">
                      <label className="trend-select"><span>From</span><select aria-label="Choose the first income period" value={incomeStartPeriod} onChange={(event) => { const nextStart = event.target.value; setIncomeStartPeriod(nextStart); if (nextStart && incomeEndPeriod && nextStart > incomeEndPeriod) setIncomeEndPeriod(nextStart); }}><option value="">Earliest period</option>{incomeData.map((row) => <option key={`income-start-${row.period}`} value={row.period}>{periodLabel(row.period)}</option>)}</select></label>
                      <label className="trend-select"><span>To</span><select aria-label="Choose the last income period" value={incomeEndPeriod} onChange={(event) => { const nextEnd = event.target.value; setIncomeEndPeriod(nextEnd); if (nextEnd && incomeStartPeriod && nextEnd < incomeStartPeriod) setIncomeStartPeriod(nextEnd); }}><option value="">Latest period</option>{incomeData.map((row) => <option key={`income-end-${row.period}`} value={row.period}>{periodLabel(row.period)}</option>)}</select></label>
                    </div>
                  </div>
                  <div className="trend-summary"><span><strong>{moneyPrecise.format(incomeSummary.total)}</strong> incoming · {incomeRange}</span><span>{incomeSummary.count} deposit{incomeSummary.count === 1 ? "" : "s"} across {incomeSummary.sourceCount} source{incomeSummary.sourceCount === 1 ? "" : "s"}</span><span className="average-summary">Average {moneyPrecise.format(incomeSummary.periodAverage)} per period</span></div>
                  <div className="trend-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={visibleIncomeData} margin={{ top: 12, right: 14, left: -10, bottom: 4 }}>
                        <CartesianGrid vertical={false} stroke="rgba(231, 215, 168, 0.13)" />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#b8b2a2", fontSize: 12 }} minTickGap={22} />
                        <YAxis tickLine={false} axisLine={false} tickFormatter={formatAxisMoney} tick={{ fill: "#b8b2a2", fontSize: 12 }} />
                        <ReferenceLine y={incomeSummary.periodAverage} stroke="#f1e2b8" strokeDasharray="5 5" label={{ value: `Avg ${moneyPrecise.format(incomeSummary.periodAverage)}`, fill: "#f1e2b8", fontSize: 11, position: "insideTopRight" }} />
                        <Tooltip cursor={{ stroke: "rgba(216, 180, 95, .45)", strokeWidth: 1 }} formatter={(value) => moneyPrecise.format(Number(value))} labelFormatter={(label) => `Incoming money · ${label}`} contentStyle={{ background: "#151b19", border: "1px solid rgba(231, 215, 168, .25)", borderRadius: 8, color: "#f7f1e3" }} />
                        <Line type="monotone" dataKey="value" name="Incoming money" stroke="#d8b45f" strokeWidth={3} dot={{ r: 4, fill: "#d8b45f", stroke: "#0d1110", strokeWidth: 2 }} activeDot={{ r: 6, fill: "#f1e2b8", stroke: "#0d1110", strokeWidth: 2 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  {!incomeTransactions.length ? (
                    <div className="detail-empty"><strong>No incoming transactions in this range.</strong><span>Positive Amount values are treated as money coming in. Try widening the date range if needed.</span></div>
                  ) : (
                    <>
                      <div className="income-detail-bar"><span>{showIncomeDetails ? "Income details" : `${incomeSummary.count} deposits · details collapsed`}</span><button className="details-toggle" type="button" aria-expanded={showIncomeDetails} onClick={() => setShowIncomeDetails((current) => !current)}>{showIncomeDetails ? "Hide details ↑" : "Show details ↓"}</button></div>
                      {showIncomeDetails && (
                        <>
                          <div className="income-detail-controls">
                            <label className="trend-select"><span>View</span><select aria-label="Choose which income details to show" value={incomeDetailView} onChange={(event) => setIncomeDetailView(event.target.value)}><option value="summary">Summary</option><option value="sources">Sources</option><option value="transactions">Transactions</option><option value="all">All details</option></select></label>
                            <label className="trend-select"><span>Source filter</span><select aria-label="Filter income details by source" value={incomeSourceFilter} onChange={(event) => setIncomeSourceFilter(event.target.value)}><option value="all">All sources</option>{incomeSources.map((source) => <option key={`income-filter-${source.key}`} value={source.key}>{source.name}</option>)}</select></label>
                          </div>
                          {(incomeDetailView === "summary" || incomeDetailView === "all") && <div className="detail-metrics"><article className="detail-metric"><span>Total incoming</span><strong>{moneyPrecise.format(incomeDetailSummary.total)}</strong></article><article className="detail-metric"><span>Deposits</span><strong>{incomeDetailSummary.count}</strong></article><article className="detail-metric"><span>Sources</span><strong>{incomeDetailSummary.sourceCount}</strong></article><article className="detail-metric"><span>Average deposit</span><strong>{moneyPrecise.format(incomeDetailSummary.average)}</strong></article></div>}
                          {(incomeDetailView === "sources" || incomeDetailView === "all") && <div className={`detail-grid ${incomeDetailView === "all" ? "" : "detail-grid-single"}`}><div className="vendor-breakdown"><div className="detail-subheading"><div><p className="eyebrow">Grouped by description</p><h3>Income sources</h3></div><span>{incomeDetailSources.length} total</span></div><div className="vendor-list">{incomeDetailSources.map((source) => <div className="vendor-row" key={source.key}><div className="vendor-row-label"><span>{source.name}</span><strong>{moneyPrecise.format(source.amount)}</strong></div><div className="vendor-row-meta"><span>{source.count} deposit{source.count === 1 ? "" : "s"}</span><span>{incomeDetailSummary.total ? `${((source.amount / incomeDetailSummary.total) * 100).toFixed(0)}%` : "0%"}</span></div><div className="vendor-track"><div style={{ width: `${incomeDetailSummary.total ? (source.amount / incomeDetailSummary.total) * 100 : 0}%` }} /></div></div>)}</div></div>{incomeDetailView === "all" && <div className="transaction-breakdown"><div className="detail-subheading"><div><p className="eyebrow">Every matching row</p><h3>Incoming transactions</h3></div><span>{incomeDetailSummary.count} total</span></div><div className="transaction-table-wrap"><table className="transaction-table"><thead><tr><th>Date</th><th>Description</th><th>Account</th><th>Amount</th></tr></thead><tbody>{incomeDetailTransactions.map((transaction) => <tr key={transaction.id}><td>{transaction.date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td><td><strong>{transaction.description || "Unknown source"}</strong>{transaction.tags && <small>{transaction.tags}</small>}</td><td>{transaction.account || "—"}</td><td>{moneyPrecise.format(transaction.amount)}</td></tr>)}</tbody></table></div></div>}</div>}
                          {incomeDetailView === "transactions" && <div className="detail-grid detail-grid-single"><div className="transaction-breakdown"><div className="detail-subheading"><div><p className="eyebrow">Every matching row</p><h3>Incoming transactions</h3></div><span>{incomeDetailSummary.count} total</span></div><div className="transaction-table-wrap"><table className="transaction-table"><thead><tr><th>Date</th><th>Description</th><th>Account</th><th>Amount</th></tr></thead><tbody>{incomeDetailTransactions.map((transaction) => <tr key={transaction.id}><td>{transaction.date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td><td><strong>{transaction.description || "Unknown source"}</strong>{transaction.tags && <small>{transaction.tags}</small>}</td><td>{transaction.account || "—"}</td><td>{moneyPrecise.format(transaction.amount)}</td></tr>)}</tbody></table></div></div></div>}
                        </>
                      )}
                    </>
                  )}
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
                  <div className="panel-heading chart-heading"><div><p className="eyebrow">Limit comparison</p><h2>Spending against plan</h2></div><div className="chart-tools"><label className="chart-view-select"><span>Scale</span><select aria-label="Choose the spending comparison scale" value={comparisonMode} onChange={(event) => setComparisonMode(event.target.value)}><option value="amount">Dollar amounts</option><option value="percent">Percent of limit</option></select></label><div className="chart-legend"><span><i className="spent-dot" />{comparisonMode === "percent" ? "Spent %" : "Spent"}</span><span><i className="limit-dot" />{comparisonMode === "percent" ? "100% limit" : "Monthly limit"}</span><span><i className="average-dot" />Avg {formatChartValue(comparisonAverage, comparisonMode)}</span></div></div></div>
                  <div className="chart-wrap">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={comparisonChartRows} margin={{ top: 12, right: 10, left: -16, bottom: 4 }} barGap={7}>
                        <CartesianGrid vertical={false} stroke="rgba(231, 215, 168, 0.13)" />
                        <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: "#b8b2a2", fontSize: 12 }} />
                        <YAxis tickLine={false} axisLine={false} tickFormatter={(value) => formatChartValue(value, comparisonMode)} tick={{ fill: "#b8b2a2", fontSize: 12 }} />
                        <ReferenceLine y={comparisonAverage} stroke="#f1e2b8" strokeDasharray="5 5" label={{ value: `Avg ${formatChartValue(comparisonAverage, comparisonMode)}`, fill: "#f1e2b8", fontSize: 11, position: "insideTopRight" }} />
                        <Tooltip cursor={{ fill: "rgba(247, 241, 227, 0.05)" }} formatter={(value, name, item) => formatChartValue(comparisonMode === "percent" ? item?.payload?.rawChartSpent ?? value : value, comparisonMode)} contentStyle={{ background: "#151b19", border: "1px solid rgba(231, 215, 168, .25)", borderRadius: 8, color: "#f7f1e3" }} />
                        <Bar dataKey="chartSpent" name={comparisonMode === "percent" ? "Spent %" : "Spent"} radius={[5, 5, 0, 0]}>{comparisonChartRows.map((row) => <Cell key={row.id} fill={row.percent > 100 ? "#fb7185" : "#d8b45f"} />)}</Bar>
                        <Bar dataKey="chartLimit" name={comparisonMode === "percent" ? "Limit" : "Monthly limit"} fill="rgba(45, 212, 191, .65)" radius={[5, 5, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="chart-note">{comparisonMode === "percent" ? "Relative view compares budgeted categories at the same scale. Bars cap at 200% so extreme outliers do not flatten the rest; hover for exact values." : "Large dollar differences can compress smaller categories. Switch to Percent of limit for a more comparable view."}</p>
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
