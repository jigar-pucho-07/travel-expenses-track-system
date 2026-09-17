import { WORKFLOW, loadWebhookUrls, validateConfig } from '../config/api';

// ─── Initialization ────────────────────────────────────────────
loadWebhookUrls();

const isMock = () => !window.__TRAVEL_DISABLE_MOCK;

// ─── Core: Call any PuchoAI workflow webhook ───────────────────
async function callWorkflow(key, payload) {
  const wf = WORKFLOW[key];
  if (!wf) throw new Error(`Unknown workflow: ${key}`);

  if (isMock() || !wf.url) {
    // Mock mode — simulate network delay then return mock data
    await new Promise(r => setTimeout(r, 600 + Math.random() * 400));
    console.debug(`[Mock] ${key}`, payload);
    return mockResponse(key, payload);
  }

  const res = await fetch(wf.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let errBody;
    try { errBody = await res.json(); } catch { errBody = {}; }
    throw new Error(errBody.error || `Request failed (${res.status})`);
  }

  return res.json();
}

// ─── File Upload: Read file as base64 ──────────────────────────
export function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      // Strip the prefix (e.g., "data:image/png;base64,") to get raw base64
      const base64 = dataUrl.split(',')[1];
      resolve({ base64, dataUrl, type: file.type, name: file.name });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─── Public API: One function per workflow ─────────────────────

/** WF1: Login — uses mock in mock mode, real /sync webhook otherwise. */
export async function loginUser(email, password) {
  // ─── Mock mode: bypass webhook entirely ──────────────────────
  if (isMock()) {
    console.debug('[Login] MOCK MODE — skipping real webhook');
    await new Promise(r => setTimeout(r, 400));
    if (email === 'demo@travel.com' && password === 'demo123') {
      return {
        success: true,
        message: 'Login successful',
        user: { user_id: 'U001', name: 'mahi', email: 'demo@travel.com', role: 'Employee' }
      };
    }
    return { success: false, message: 'Invalid email or password' };
  }

  // ─── Real mode: PuchoAI /sync webhook ────────────────────────
  const wf = WORKFLOW.login;
  const url = wf?.url;

  console.debug('[Login] Calling:', url || 'NOT CONFIGURED');

  if (!url) {
    return { success: false, message: 'Login service not configured. Set VITE_WF_LOGIN in .env' };
  }

  try {
    const httpRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const status = httpRes.status;
    const contentType = httpRes.headers.get('content-type') || '';
    const rawBody = await httpRes.text();

    console.debug('[Login] HTTP', status, 'Content-Type:', contentType);
    console.debug('[Login] Raw body (first 500 chars):', rawBody.substring(0, 500));

    // ─── Step 1: Try direct JSON parse ──────────────────────────
    let parsed;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      // ─── Step 2: Maybe wrapped in HTML? Try extracting ─────────
      const jsonMatch = rawBody.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch {
          console.error('[Login] Could not extract JSON from response');
          return { success: false, message: 'Server returned an invalid response. Please try again.' };
        }
      } else {
        console.error('[Login] No JSON found in response:', rawBody.substring(0, 200));
        return { success: false, message: 'Server returned an invalid response. Please try again.' };
      }
    }

    console.debug('[Login] Parsed:', JSON.stringify(parsed).substring(0, 300));

    // ─── Step 3: Normalize success field (SHORT_TEXT → boolean) ─
    let success = parsed.success;
    if (success === 'true' || success === 'True') success = true;
    if (success === 'false' || success === 'False') success = false;

    const message = parsed.message || '';

    // ─── Step 4: Handle failed login ────────────────────────────
    if (success !== true) {
      return { success: false, message: message || 'Invalid email or password' };
    }

    // ─── Step 5: Extract user object ────────────────────────────
    let user = parsed.user;

    // User might be a JSON string (PuchoAI nests objects as strings in SHORT_TEXT)
    if (typeof user === 'string') {
      try { user = JSON.parse(user); } catch { /* keep as-is */ }
    }

    if (!user || typeof user !== 'object' || !user.user_id) {
      console.error('[Login] Invalid user data:', user);
      return { success: false, message: 'Login response missing user data' };
    }

    console.debug('[Login] SUCCESS — user:', user.email);
    return { success: true, message, user };

  } catch (err) {
    console.error('[Login] Network/parse error:', err.message);
    return { success: false, message: 'Unable to connect. Please check your connection and try again.' };
  }
}

/** WF2: Create Trip — uses real webhook when VITE_WF_CREATE_TRIP is set. */
export async function createTrip(tripData) {
  return callWorkflow('create_trip', tripData);
}

/** WF2: Create Trip — ALWAYS calls real /sync webhook regardless of mock mode. */
export async function createTripReal(tripData) {
  const url = import.meta.env.VITE_WF_CREATE_TRIP;
  console.debug('[WF2] Real webhook URL:', url || 'NOT SET');

  if (!url) {
    console.debug('[WF2] No URL — falling back to mock');
    return callWorkflow('create_trip', tripData);
  }

  try {
    const httpRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tripData),
    });

    const status = httpRes.status;
    const rawBody = await httpRes.text();
    console.debug('[WF2] HTTP', status, 'Body:', rawBody.substring(0, 400));

    let parsed;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      const m = rawBody.match(/\{[\s\S]*\}/);
      if (m) {
        parsed = JSON.parse(m[0]);
      } else {
        throw new Error('Invalid response from server');
      }
    }

    console.debug('[WF2] Parsed:', JSON.stringify(parsed).substring(0, 300));

    // In case return_response "Raw" wraps JSON inside a "body" field
    if (parsed.body && typeof parsed.body === 'string') {
      try {
        // Attempt to parse body field as JSON (PuchoAI Raw response pattern)
        const unwrapped = JSON.parse(parsed.body);
        console.debug('[WF2] Unwrapped body field');
        parsed = unwrapped;
      } catch {}
    }

    const success = parsed.success === true || parsed.success === 'true' || parsed.success === 'True';
    if (!success) {
      return {
        success: false,
        message: parsed.message || 'Trip creation failed',
        errors: parsed.errors || []
      };
    }

    let trip = parsed.trip;
    if (typeof trip === 'string') {
      try { trip = JSON.parse(trip); } catch {}
    }

    return {
      success: true,
      trip_id: parsed.trip_id || (trip ? trip.trip_id : ''),
      message: parsed.message || 'Trip created successfully',
      trip: trip || null
    };

  } catch (err) {
    console.error('[WF2] Failed:', err.message);
    return { success: false, message: 'Unable to connect. Please try again.', errors: [] };
  }
}

/** WF3: Add Expense — ALWAYS calls real /sync webhook regardless of mock mode. */
export async function addExpenseReal(expenseData) {
  const url = import.meta.env.VITE_WF_ADD_EXPENSE;
  console.debug('[WF3] Real webhook URL:', url || 'NOT SET');
  if (!url) { console.debug('[WF3] No URL — falling back to mock'); return callWorkflow('add_expense', expenseData); }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    let httpRes, rawBody;
    try {
      httpRes = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(expenseData),
        signal: controller.signal,
      });
      rawBody = await httpRes.text();
    } finally {
      clearTimeout(timeoutId);
    }

    console.debug('[WF3] HTTP', httpRes.status, 'Body:', rawBody.substring(0, 300));

    let parsed;
    try { parsed = JSON.parse(rawBody); } catch {
      const m = rawBody.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]); else throw new Error('Invalid response');
    }
    // Unwrap Raw body field
    if (parsed.body && typeof parsed.body === 'string') { try { parsed = JSON.parse(parsed.body); } catch {} }

    const success = parsed.success === true || parsed.success === 'true' || parsed.success === 'True';
    return {
      success: success,
      expense_id: parsed.expense_id || '',
      message: parsed.message || (success ? 'Expense added' : 'Failed'),
      errors: parsed.errors || [],
    };
  } catch (err) {
    console.error('[WF3] Real call failed:', err.message);
    return { success: false, message: 'Unable to save expense. Please try again.', errors: [] };
  }
}

/** WF5: Trip Summary — ALWAYS calls real /sync webhook regardless of mock mode. */
export async function getTripSummaryReal(trip_id, budget) {
  const url = import.meta.env.VITE_WF_TRIP_SUMMARY;
  console.debug('[WF5] Real webhook URL:', url || 'NOT SET');
  if (!url) { return { success: false, message: 'Trip summary service not configured' }; }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    let httpRes, rawBody;
    try {
      httpRes = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trip_id, budget }),
        signal: controller.signal,
      });
      rawBody = await httpRes.text();
    } finally {
      clearTimeout(timeoutId);
    }

    console.debug('[WF5] HTTP', httpRes.status, 'Body:', rawBody.substring(0, 400));

    let parsed;
    try { parsed = JSON.parse(rawBody); } catch {
      const m = rawBody.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]); else throw new Error('Invalid response');
    }
    if (parsed.body && typeof parsed.body === 'string') { try { parsed = JSON.parse(parsed.body); } catch {} }

    const success = parsed.success === true || parsed.success === 'true' || parsed.success === 'True';
    if (!success) {
      return { success: false, message: parsed.message || 'Unable to load trip summary' };
    }

    let cats = parsed.categories;
    if (typeof cats === 'string') { try { cats = JSON.parse(cats); } catch {} }
    let recent = parsed.recent_expenses;
    if (typeof recent === 'string') { try { recent = JSON.parse(recent); } catch {} }
    let highest = parsed.highest_expense;
    if (typeof highest === 'string') { try { highest = JSON.parse(highest); } catch {} }

    return {
      success: true,
      trip_id: parsed.trip_id || trip_id,
      budget: parseFloat(parsed.budget) || 0,
      total_spent: parseFloat(parsed.total_spent) || 0,
      remaining: parseFloat(parsed.remaining) || 0,
      budget_status: parsed.budget_status || 'Within Budget',
      expense_count: parseInt(parsed.expense_count) || 0,
      highest_expense: highest || null,
      categories: cats || {},
      recent_expenses: recent || [],
    };
  } catch (err) {
    const message = err.name === 'AbortError'
      ? 'Trip summary request timed out. Please try again.'
      : 'Unable to load trip summary. Please try again.';
    console.error('[WF5] Real call failed:', message, err.message);
    return { success: false, message };
  }
}

/** WF4: Process Receipt — ALWAYS calls real /sync webhook regardless of mock mode. */
export async function processReceipt({ file_data, file_name, file_type }) {
  return callWorkflow('process_receipt', { file_data, file_name, file_type });
}

/** WF4: Process Receipt — REAL webhook call bypassing mock mode. */
export async function processReceiptReal({ file_data, file_name, file_type }) {
  const url = import.meta.env.VITE_WF_PROCESS_RECEIPT;
  console.debug('[WF4] Real webhook URL:', url || 'NOT SET');
  if (!url) { console.debug('[WF4] No URL — falling back to mock'); return callWorkflow('process_receipt', { file_data, file_name, file_type }); }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    let httpRes, rawBody;
    try {
      httpRes = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_data, file_name, file_type }),
        signal: controller.signal,
      });
      rawBody = await httpRes.text();
    } finally { clearTimeout(timeoutId); }

    console.debug('[WF4] HTTP', httpRes.status, 'Body:', rawBody.substring(0, 400));

    let parsed;
    try { parsed = JSON.parse(rawBody); } catch {
      const m = rawBody.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]); else throw new Error('Invalid response');
    }
    if (parsed.body && typeof parsed.body === 'string') { try { parsed = JSON.parse(parsed.body); } catch {} }

    const success = parsed.success === true || parsed.success === 'true' || parsed.success === 'True';
    let extracted = parsed.extracted;
    if (typeof extracted === 'string') { try { extracted = JSON.parse(extracted); } catch {} }

    return {
      success: success,
      extracted: extracted || null,
      receipt_url: parsed.receipt_url || '',
      message: parsed.message || '',
    };
  } catch (err) {
    console.error('[WF4] Failed, falling back to mock:', err.message);
    return mockResponse('process_receipt', { file_data, file_name, file_type });
  }
}

/** WF5: Trip Summary */
export async function getTripSummary(trip_id, budget) {
  return callWorkflow('trip_summary', { trip_id, budget });
}

/** WF6: Complete Trip */
export async function completeTrip(trip_id) {
  return callWorkflow('complete_trip', { trip_id });
}

/** WF6: Complete Trip — REAL webhook call bypassing mock mode. */
export async function completeTripReal(trip_id) {
  const url = import.meta.env.VITE_WF_COMPLETE_TRIP;
  console.debug('[WF6] Real webhook URL:', url || 'NOT SET');
  if (!url) { console.debug('[WF6] No URL — falling back to mock'); return callWorkflow('complete_trip', { trip_id }); }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    let httpRes, rawBody;
    try {
      httpRes = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trip_id }),
        signal: controller.signal,
      });
      rawBody = await httpRes.text();
    } finally { clearTimeout(timeoutId); }

    console.debug('[WF6] HTTP', httpRes.status, 'Body:', rawBody.substring(0, 400));

    let parsed;
    try { parsed = JSON.parse(rawBody); } catch {
      const m = rawBody.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]); else throw new Error('Invalid response');
    }
    if (parsed.body && typeof parsed.body === 'string') { try { parsed = JSON.parse(parsed.body); } catch {} }

    return {
      success: parsed.success === true || parsed.success === 'true' || parsed.success === 'True',
      report_url: parsed.report_url || '',
      total: parseFloat(parsed.total) || 0,
      budget: parseFloat(parsed.budget) || 0,
      remaining: parseFloat(parsed.remaining) || 0,
      categories: parsed.categories || {},
      expense_count: parseInt(parsed.expense_count) || 0,
      message: parsed.message || '',
    };
  } catch (err) {
    const message = err.name === 'AbortError'
      ? 'Trip completion timed out. Please try again.'
      : 'Unable to complete trip. Please try again.';
    console.error('[WF6] Real call failed:', message, err.message);
    return { success: false, message };
  }
}

// ─── Mock Responses (development only) ─────────────────────────
let mockTripCounter = 1000;
let mockExpenseCounter = 1000;

export function mockResponse(action, payload) {
  const ts = Date.now().toString(36).toUpperCase().slice(-4);
  switch (action) {
    // login: NO mock — always uses real /sync webhook

    case 'create_trip': {
      const id = `TRIP-${++mockTripCounter}`;
      return { success: true, trip_id: id, message: 'Trip created successfully' };
    }

    case 'add_expense': {
      const id = `EXP-${++mockExpenseCounter}`;
      return { success: true, expense_id: id, message: 'Expense added successfully' };
    }

    case 'process_receipt':
      return {
        success: true,
        extracted: {
          merchant: 'ABC Restaurant',
          date: '2026-09-02',
          amount: 450,
          tax: 0,
          invoice_number: 'INV-001',
          category: 'Food'
        },
        receipt_url: 'https://drive.google.com/mock-receipt-url'
      };

    case 'trip_summary': {
      const budget = parseFloat(payload.budget) || 20000;
      return {
        success: true,
        trip_id: payload.trip_id,
        budget: budget,
        total_spent: 11450,
        remaining: budget - 11450,
        budget_status: budget >= 11450 ? 'Within Budget' : 'Budget Exceeded',
        expense_count: 5,
        highest_expense: { merchant: 'Air India', amount: 3500, category: 'Transportation', date: '2026-09-01' },
        categories: { Transportation: 4500, Hotel: 3000, Food: 1850, Cab: 1200, Other: 900 },
        recent_expenses: [
          { expense_id: 'EXP-1005', date: '2026-09-03', category: 'Food', merchant: 'ABC Restaurant', amount: 450, status: 'Verified' },
          { expense_id: 'EXP-1004', date: '2026-09-02', category: 'Cab', merchant: 'Uber', amount: 1200, status: 'Verified' },
          { expense_id: 'EXP-1003', date: '2026-09-02', category: 'Hotel', merchant: 'Taj Hotel', amount: 3000, status: 'Verified' },
          { expense_id: 'EXP-1002', date: '2026-09-01', category: 'Transportation', merchant: 'Air India', amount: 3500, status: 'Verified' },
          { expense_id: 'EXP-1001', date: '2026-09-01', category: 'Transportation', merchant: 'IRCTC', amount: 1000, status: 'Verified' },
        ],
      };
    }

    case 'complete_trip':
      return {
        success: true,
        report_url: 'https://drive.google.com/mock-report-url',
        total: 11450, budget: 20000, remaining: 8550,
        categories: { Transportation: 4500, Hotel: 3000, Food: 1850, Cab: 1200, Other: 900 },
        expense_count: 5,
        message: 'Trip completed and report generated successfully'
      };

    case 'list_trips':
      return {
        success: true,
        trips: [
          { trip_id: 'TRIP-1001', user_id: 'U001', trip_name: 'Mumbai Business Trip', source: 'Ahmedabad', destination: 'Mumbai', start_date: '2026-09-01', end_date: '2026-09-04', purpose: 'Business Meeting', budget: 20000, status: 'Active' },
          { trip_id: 'TRIP-1002', user_id: 'U001', trip_name: 'Delhi Client Visit', source: 'Ahmedabad', destination: 'Delhi', start_date: '2026-08-15', end_date: '2026-08-18', purpose: 'Client Meeting', budget: 35000, status: 'Completed' },
          { trip_id: 'TRIP-1003', user_id: 'U001', trip_name: 'Bangalore Training', source: 'Mumbai', destination: 'Bangalore', start_date: '2026-07-10', end_date: '2026-07-12', purpose: 'Team Training', budget: 15000, status: 'Completed' },
        ]
      };

    default:
      return { success: false, error: `Unknown mock action: ${action}` };
  }
}

// ─── Config validation (call on app mount) ─────────────────────
export function checkConfig() {
  const errors = validateConfig();
  if (errors.length > 0) {
    console.warn('[Travel Tracker] Config errors:', errors);
  }
  return errors;
}

/** WF7: List Trips for a user */
/** WF7: List Trips — ALWAYS calls real /sync webhook regardless of mock mode. */
export async function listTrips(user_id) {
  const url = import.meta.env.VITE_WF_LIST_TRIPS;
  console.debug('[WF7] Real webhook URL:', url || 'NOT SET');
  if (!url) { console.debug('[WF7] No URL — falling back to mock'); return callWorkflow('list_trips', { user_id }); }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    let httpRes, rawBody;
    try {
      httpRes = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id }),
        signal: controller.signal,
      });
      rawBody = await httpRes.text();
    } finally { clearTimeout(timeoutId); }

    console.debug('[WF7] HTTP', httpRes.status, 'Body:', rawBody.substring(0, 300));

    let parsed;
    try { parsed = JSON.parse(rawBody); } catch {
      const m = rawBody.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]); else throw new Error('Invalid response');
    }
    if (parsed.body && typeof parsed.body === 'string') { try { parsed = JSON.parse(parsed.body); } catch {} }

    let trips = parsed.trips;
    if (typeof trips === 'string') { try { trips = JSON.parse(trips); } catch {} }

    console.debug('[WF7] Trips loaded:', Array.isArray(trips) ? trips.length : 0);
    return { success: true, trips: trips || [] };

  } catch (err) {
    console.error('[WF7] Failed, falling back to mock:', err.message);
    return mockResponse('list_trips', { user_id });
  }
}

export async function listReportsReal(user_id) {
  const url = import.meta.env.VITE_WF_LIST_REPORTS;
  console.debug('[WF8] Real webhook URL:', url || 'NOT SET');
  if (!url) { return { success: true, reports: [] }; }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    let httpRes, rawBody;
    try {
      httpRes = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id }),
        signal: controller.signal,
      });
      rawBody = await httpRes.text();
    } finally { clearTimeout(timeoutId); }

    console.debug('[WF8] HTTP', httpRes.status, 'Body:', rawBody.substring(0, 300));

    let parsed;
    try { parsed = JSON.parse(rawBody); } catch {
      const m = rawBody.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]); else return { success: true, reports: [] };
    }
    if (parsed.body && typeof parsed.body === 'string') { try { parsed = JSON.parse(parsed.body); } catch {} }

    let reports = parsed.reports;
    if (typeof reports === 'string') { try { reports = JSON.parse(reports); } catch {} }

    console.debug('[WF8] Reports loaded:', Array.isArray(reports) ? reports.length : 0);
    return { success: true, reports: reports || [] };
  } catch (err) {
    console.error('[WF8] Failed:', err.message);
    return { success: true, reports: [] };
  }
}

/** WF11: Reopen Trip — updates trip status to Active. */
export async function reopenTripReal(trip_id) {
  const url = import.meta.env.VITE_WF_REOPEN_TRIP;
  if (!url) { return { success: false, message: 'Reopen service not configured' }; }
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    let httpRes, rawBody;
    try {
      httpRes = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trip_id, status: 'Active' }), signal: controller.signal,
      });
      rawBody = await httpRes.text();
    } finally { clearTimeout(timeoutId); }
    let parsed;
    try { parsed = JSON.parse(rawBody); } catch {
      const m = rawBody.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]); else throw new Error('Invalid response');
    }
    if (parsed.body && typeof parsed.body === 'string') { try { parsed = JSON.parse(parsed.body); } catch {} }
    return parsed;
  } catch (err) {
    return { success: false, message: 'Unable to reopen trip. Please try again.' };
  }
}

/** WF12: Update Expense — updates specific expense fields */
export async function updateExpenseReal(payload) {
  const url = import.meta.env.VITE_WF_UPDATE_EXPENSE;
  if (!url) { return { success: false, message: 'Update service not configured' }; }
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    let httpRes, rawBody;
    try {
      httpRes = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: controller.signal,
      });
      rawBody = await httpRes.text();
    } finally { clearTimeout(timeoutId); }
    let parsed;
    try { parsed = JSON.parse(rawBody); } catch {
      const m = rawBody.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]); else throw new Error('Invalid response');
    }
    if (parsed.body && typeof parsed.body === 'string') { try { parsed = JSON.parse(parsed.body); } catch {} }
    return parsed;
  } catch (err) { return { success: false, message: 'Unable to update expense. Please try again.' }; }
}

// ─── Legacy compatibility (for existing code transitioning) ────
export const triggerWorkflow = (action, payload) => {
  switch (action) {
    case 'login': return loginUser(payload.email, payload.password);
    case 'create_trip': return createTrip(payload);
    case 'add_expense': return addExpenseReal(payload);
    case 'process_receipt': return processReceiptReal(payload);
    case 'trip_summary': return getTripSummaryReal(payload.trip_id, payload.budget);
    case 'complete_trip': return completeTripReal(payload.trip_id);
    case 'list_trips': return listTrips(payload.user_id);
    case 'list_reports': return listReportsReal(payload.user_id);
    case 'reopen_trip': return reopenTripReal(payload.trip_id);
    case 'update_expense': return updateExpenseReal(payload);
    default: throw new Error(`Unknown action: ${action}`);
  }
};