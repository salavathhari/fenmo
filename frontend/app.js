const API_BASE = "";
const PENDING_REQUEST_ID_KEY = "expense_form_pending_request_id";

const form = document.getElementById("expense-form");
const submitBtn = document.getElementById("submit-btn");
const retryBtn = document.getElementById("retry-btn");
const formStatus = document.getElementById("form-status");

const amountInput = document.getElementById("amount");
const dateInput = document.getElementById("date");
const categoryInput = document.getElementById("category");
const descriptionInput = document.getElementById("description");

const filterCategoryInput = document.getElementById("filter-category");
const sortOrderInput = document.getElementById("sort-order");
const refreshBtn = document.getElementById("refresh-btn");
const listStatus = document.getElementById("list-status");
const expensesBody = document.getElementById("expenses-body");
const totalEl = document.getElementById("total");
const categorySummaryEl = document.getElementById("category-summary");

let lastFailedPayload = null;

function generateRequestId() {
  if (window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function getPendingRequestId() {
  return localStorage.getItem(PENDING_REQUEST_ID_KEY);
}

function setPendingRequestId(requestId) {
  localStorage.setItem(PENDING_REQUEST_ID_KEY, requestId);
}

function clearPendingRequestId() {
  localStorage.removeItem(PENDING_REQUEST_ID_KEY);
}

function amountStringToPaise(amountStr) {
  const match = String(amountStr).trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) {
    return 0;
  }

  const rupees = Number(match[1]);
  const paisePart = (match[2] || "").padEnd(2, "0") || "00";
  return rupees * 100 + Number(paisePart);
}

function formatPaiseToAmount(paise) {
  const rupees = Math.floor(paise / 100);
  const remainder = String(paise % 100).padStart(2, "0");
  return `${rupees}.${remainder}`;
}

function renderCategorySummary(expenses) {
  categorySummaryEl.innerHTML = "";

  if (expenses.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No category totals for current view";
    categorySummaryEl.appendChild(item);
    return;
  }

  const totalsByCategory = new Map();

  for (const expense of expenses) {
    const current = totalsByCategory.get(expense.category) || 0;
    totalsByCategory.set(expense.category, current + amountStringToPaise(expense.amount));
  }

  for (const [category, totalPaise] of totalsByCategory.entries()) {
    const item = document.createElement("li");
    item.textContent = `${category}: ₹${formatPaiseToAmount(totalPaise)}`;
    categorySummaryEl.appendChild(item);
  }
}

function renderExpenses(expenses) {
  expensesBody.innerHTML = "";

  if (expenses.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.textContent = "No expenses found";
    row.appendChild(cell);
    expensesBody.appendChild(row);
    totalEl.textContent = "Total: ₹0.00";
    renderCategorySummary([]);
    return;
  }

  let totalPaise = 0;

  for (const expense of expenses) {
    totalPaise += amountStringToPaise(expense.amount);

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${expense.date}</td>
      <td>${expense.category}</td>
      <td>${expense.description}</td>
      <td>₹${expense.amount}</td>
    `;
    expensesBody.appendChild(row);
  }

  totalEl.textContent = `Total: ₹${formatPaiseToAmount(totalPaise)}`;
  renderCategorySummary(expenses);
}

async function fetchExpenses() {
  listStatus.textContent = "Loading expenses...";

  const params = new URLSearchParams();
  const category = filterCategoryInput.value.trim();
  const sort = sortOrderInput.value;

  if (category) {
    params.set("category", category);
  }

  if (sort) {
    params.set("sort", sort);
  }

  const query = params.toString();
  const url = `${API_BASE}/expenses${query ? `?${query}` : ""}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to fetch expenses");
    }

    renderExpenses(data.expenses || []);
    listStatus.textContent = "";
  } catch (error) {
    listStatus.textContent = error.message;
  }
}

async function submitExpense(event) {
  event.preventDefault();

  formStatus.textContent = "";
  submitBtn.disabled = true;

  const requestId = getPendingRequestId() || generateRequestId();
  setPendingRequestId(requestId);

  const payload = {
    request_id: requestId,
    amount: amountInput.value,
    category: categoryInput.value,
    description: descriptionInput.value,
    date: dateInput.value
  };

  try {
    const response = await fetch(`${API_BASE}/expenses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to add expense");
    }

    clearPendingRequestId();
    lastFailedPayload = null;
    retryBtn.hidden = true;
    form.reset();
    formStatus.textContent = "Expense saved";
    await fetchExpenses();
  } catch (error) {
    lastFailedPayload = payload;
    retryBtn.hidden = false;
    formStatus.textContent = `Submit failed: ${error.message}. Retry will not duplicate.`;
  } finally {
    submitBtn.disabled = false;
  }
}

async function retryLastSubmit() {
  if (!lastFailedPayload) {
    formStatus.textContent = "No failed submission to retry.";
    return;
  }

  formStatus.textContent = "Retrying last submit...";
  retryBtn.disabled = true;
  submitBtn.disabled = true;

  try {
    const response = await fetch(`${API_BASE}/expenses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(lastFailedPayload)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Retry failed");
    }

    clearPendingRequestId();
    lastFailedPayload = null;
    retryBtn.hidden = true;
    form.reset();
    formStatus.textContent = "Expense saved";
    await fetchExpenses();
  } catch (error) {
    formStatus.textContent = `Retry failed: ${error.message}.`;
  } finally {
    retryBtn.disabled = false;
    submitBtn.disabled = false;
  }
}

form.addEventListener("submit", submitExpense);
retryBtn.addEventListener("click", retryLastSubmit);
refreshBtn.addEventListener("click", fetchExpenses);
filterCategoryInput.addEventListener("input", fetchExpenses);
sortOrderInput.addEventListener("change", fetchExpenses);

fetchExpenses();
