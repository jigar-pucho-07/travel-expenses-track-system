import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Plane, Plus, CheckCircle, XCircle, Edit3 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { toast } from 'sonner';
import { triggerWorkflow } from '../services/api';

function Card({ children, className = '' }) {
  return <div className={`bg-white rounded-2xl border border-line shadow-card p-5 ${className}`}>{children}</div>;
}

function StatusPill({ status }) {
  const map = { Active: 'bg-ok-bg text-ok', Completed: 'bg-brand-50 text-brand', Cancelled: 'bg-err-bg text-err' };
  return <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${map[status] || 'bg-off-bg text-off'}`}>{status}</span>;
}

function InfoRow({ label, value }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex justify-between items-center py-1.5">
      <span className="text-xs text-ink-muted">{label}</span>
      <span className="text-sm font-medium text-ink">{value}</span>
    </div>
  );
}

function detectTransportType(exp) {
  if (!exp) return 'transport';
  const m = (exp.merchant || '').toUpperCase();
  if (/RAILWAY|IRCTC|TRAIN/i.test(m)) return 'train';
  if (/AIRLINE|AIRWAYS|AIR\b|FLIGHT|INDIGO|SPICEJET|VISTARA|AIR INDIA|AIRASIA/i.test(m)) return 'flight';
  if (/BUS\b|DEPOT|GSRTC|TRANSPORT/i.test(m)) return 'bus';
  if (/METRO/i.test(m)) return 'metro';
  if (/UBER|OLA|CAB|TAXI/i.test(m)) return 'cab';
  return 'transport';
}

function calcSubtotal(exp) {
  const gst = parseFloat(exp.gst_in_inr ?? exp.gst) || 0;
  const cgst = parseFloat(exp.cgst_in_inr ?? exp.cgst) || 0;
  const sgst = parseFloat(exp.sgst_in_inr ?? exp.sgst) || 0;
  const tax = parseFloat(exp.tax_in_inr ?? exp.tax) || 0;
  const amount = parseFloat(exp.amount_in_inr ?? exp.amount) || 0;

  let totalTax = 0;
  if (gst > 0) totalTax = gst;
  else if (cgst > 0 || sgst > 0) totalTax = cgst + sgst;
  else if (tax > 0) totalTax = tax;

  return { totalTax, subtotal: amount - totalTax };
}

export default function TripDetails() {
  const location = useLocation();
  const navigate = useNavigate();
  const tripFromNav = location.state?.trip;
  const [resolvedTripId, setResolvedTripId] = useState(
    location.state?.tripId || localStorage.getItem('tripDetails_tripId') || ''
  );
  const [resolvedTrip, setResolvedTrip] = useState(location.state?.trip || null);
  const [resolving, setResolving] = useState(
    !(location.state?.tripId || localStorage.getItem('tripDetails_tripId'))
  );

  const tripId = resolvedTripId;
  const tripFromNavActive = resolvedTrip || tripFromNav;

  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState({});
  const [editItems, setEditItems] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Persist current trip_id across browser refreshes
  useEffect(() => {
    if (resolvedTripId) {
      localStorage.setItem('tripDetails_tripId', resolvedTripId);
    }
  }, [resolvedTripId]);

  // Resolve real trip details when trip object not available (direct load / refresh)
  useEffect(() => {
    if (!resolvedTripId || resolvedTrip) return;
    triggerWorkflow('list_trips', { user_id: 'U001' }).then(res => {
      if (res.success && res.trips?.length) {
        const trip = res.trips.find(t => t.trip_id === resolvedTripId);
        if (trip) setResolvedTrip(trip);
      }
    });
  }, [resolvedTripId, resolvedTrip]);

  // Fetch trip list when no trip selected
  const [allTrips, setAllTrips] = useState([]);
  useEffect(() => {
    if (!resolvedTripId) {
      triggerWorkflow('list_trips', { user_id: 'U001' }).then(res => {
        if (res.success && res.trips?.length) {
          setAllTrips(Array.isArray(res.trips) ? res.trips : JSON.parse(res.trips));
        }
        setLoading(false);
        setResolving(false);
      }).catch(() => {
        setLoading(false);
        setResolving(false);
        setError('Unable to load trips');
      });
    }
  }, [resolvedTripId]);

  const fetchSummary = async () => {
    if (!resolvedTripId) return;
    setLoading(true);
    setError(null);
    try {
      const budget = tripFromNavActive?.budget || 0;
      const res = await triggerWorkflow('trip_summary', { trip_id: resolvedTripId, budget });
      if (res.success) {
        setSummary(prev => {
          if (prev && prev.trip_id === resolvedTripId) {
            return prev;
          }
          return res;
        });
      } else {
        setError(res.message || res.error || 'Failed to load trip summary');
      }
    } catch (e) {
      setError(e.message || 'Failed to load trip summary');
    } finally {
      setLoading(false);
      setResolving(false);
    }
  };

  useEffect(() => { if (resolvedTripId) fetchSummary(); }, [resolvedTripId]);

  const handleComplete = async () => {
    setCompleting(true);
    try {
      const res = await triggerWorkflow('complete_trip', { trip_id: tripId });
      if (res.success) {
        toast.success('Trip completed! Report generated.');
        setResolvedTrip(null);
        fetchSummary();
      } else {
        toast.error(res.error || 'Failed to complete trip');
      }
    } catch (e) {
      toast.error(e.message || 'Failed to complete trip');
    } finally {
      setCompleting(false);
    }
  };

  const handleReopen = async () => {
    setReopening(true);
    try {
      const res = await triggerWorkflow('reopen_trip', { trip_id: tripId });
      if (res.success) {
        toast.success('Trip reopened successfully!');
        setResolvedTrip(null);
        fetchSummary();
      } else {
        toast.error(res.message || 'Failed to reopen trip');
      }
    } catch (e) {
      toast.error(e.message || 'Failed to reopen trip');
    } finally {
      setReopening(false);
    }
  };

  const handleSaveEdit = async () => {
    setSaving(true);
    try {
      const exp = selectedExpense;
      const payload = { expense_id: exp.expense_id };

      if (editData.merchant !== exp.merchant) payload.merchant = editData.merchant;
      if (editData.amount !== exp.amount) payload.amount = parseFloat(editData.amount);
      if ((parseFloat(editData.tax)||0) !== (parseFloat(exp.tax)||0)) payload.tax = parseFloat(editData.tax);
      if ((parseFloat(editData.sgst)||0) !== (parseFloat(exp.sgst)||0)) payload.sgst = parseFloat(editData.sgst);
      if ((parseFloat(editData.cgst)||0) !== (parseFloat(exp.cgst)||0)) payload.cgst = parseFloat(editData.cgst);
      if ((parseFloat(editData.gst)||0) !== (parseFloat(exp.gst)||0)) payload.gst = parseFloat(editData.gst);
      if (editData.gstin !== exp.gstin) payload.gstin = editData.gstin;
      if (editData.invoice_number !== exp.invoice_number) payload.invoice_number = editData.invoice_number;
      if (editData.date !== exp.date) payload.expense_date = editData.date;
      const origItems = (() => {
        try { return exp.items_json ? (typeof exp.items_json === 'string' ? JSON.parse(exp.items_json) : exp.items_json) : []; }
        catch { return []; }
      })();
      if (JSON.stringify(editItems) !== JSON.stringify(origItems)) payload.items = editItems;

      const res = await triggerWorkflow('update_expense', payload);
      if (res.success) {
        toast.success('Expense updated!');
        setSelectedExpense({ ...exp, ...editData, items_json: JSON.stringify(editItems), amount: parseFloat(editData.amount) || exp.amount, tax: parseFloat(editData.tax) || exp.tax, sgst: parseFloat(editData.sgst) || exp.sgst, cgst: parseFloat(editData.cgst) || exp.cgst, gst: parseFloat(editData.gst) || exp.gst });
        setEditMode(false);
        fetchSummary();
      } else {
        toast.error(res.message || 'Failed to update expense');
      }
    } catch (e) {
      toast.error(e.message || 'Failed to update expense');
    } finally { setSaving(false); }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        {[...Array(4)].map((_, i) => <div key={i} className="bg-white rounded-2xl h-32 animate-pulse" />)}
      </div>
    );
  }

  if (!resolvedTripId) {
    return (
      <div className="space-y-6">
        <Card>
          <h2 className="text-lg font-semibold text-ink mb-2">All Trips</h2>
          <p className="text-xs text-ink-muted mb-4">Select a trip to view its details</p>
          {allTrips.length === 0 ? (
            <p className="text-sm text-ink-muted text-center py-8">No trips available.</p>
          ) : (
            <div className="space-y-2">
              {allTrips.map(trip => (
                <div key={trip.trip_id}
                  className="flex items-center justify-between p-3 rounded-xl bg-canvas-soft hover:bg-brand-50/30 cursor-pointer transition-colors"
                  onClick={() => {
                    setResolvedTripId(trip.trip_id);
                    setResolvedTrip(trip);
                  }}>
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
                      <Plane className="w-5 h-5 text-brand" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink truncate">{trip.trip_name}</p>
                      <p className="text-xs text-ink-muted truncate">{trip.destination} · {trip.start_date} — {trip.end_date}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                    <span className="text-sm font-medium text-ink whitespace-nowrap">₹{(trip.budget || 0).toLocaleString('en-IN')}</span>
                    <StatusPill status={trip.status || 'Active'} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <div className="text-center py-8">
          <p className="text-sm text-err mb-4">{error}</p>
          <button onClick={fetchSummary} className="h-9 px-4 rounded-full text-sm font-medium text-brand bg-brand-50 hover:bg-brand-100">
            Retry
          </button>
        </div>
      </Card>
    );
  }

  const s = summary || {};
  const cats = s.categories || {};
  const catData = (() => {
    let merged = { ...cats };
    if ('Cab' in merged) {
      merged.Transportation = (merged.Transportation || 0) + (merged.Cab || 0);
      delete merged.Cab;
    }
    return Object.entries(merged).map(([k, v]) => ({ label: k, amount: v }));
  })();
  const budget = s.budget || 0;
  const spent = s.total_spent || 0;
  const remaining = s.remaining || 0;
  const overBudget = budget > 0 && spent >= budget;

  const tripStatus = tripFromNavActive?.status || 'Active';
  const isCompleted = tripStatus === 'Completed';
  const isActive = !isCompleted;

  const tripName = tripFromNavActive?.trip_name || '';
  const tripDest = tripFromNavActive?.destination || '';
  const tripStart = tripFromNavActive?.start_date || '';
  const tripEnd = tripFromNavActive?.end_date || '';

  return (
    <div className="space-y-6">
      {/* Trip Header */}
      <Card>
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-brand-50 flex items-center justify-center">
              <Plane className="w-6 h-6 text-brand" />
            </div>
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h2 className="text-xl font-bold text-ink">{tripName}</h2>
                <StatusPill status={tripFromNavActive?.status || 'Active'} />
              </div>
              <p className="text-sm text-ink-muted">{tripDest}{tripStart ? ` · ${tripStart} — ${tripEnd}` : ''}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { if (!tripId) { toast.error('Trip ID is missing'); return; } navigate('/add-expense', { state: { tripId } }); }}
              disabled={isCompleted}
              className={`flex items-center gap-2 h-10 px-4 rounded-full text-sm font-medium shadow-soft transition-all
                ${isCompleted ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'text-white hover:brightness-105'}`}
              style={isCompleted ? {} : { background: 'linear-gradient(180deg,#5833EF 0%,#3A10CE 100%)' }}>
              <Plus className="w-4 h-4" /> Add Expense
            </button>
            {isActive && (
              <button onClick={handleComplete} disabled={completing}
                className="flex items-center gap-2 h-10 px-4 rounded-full bg-ok-bg text-ok text-sm font-medium hover:bg-ok-bg/80 transition-all disabled:opacity-60">
                <CheckCircle className="w-4 h-4" /> {completing ? 'Completing...' : 'Complete Trip'}
              </button>
            )}
            {isCompleted && (
              <button onClick={handleReopen} disabled={reopening}
                className="flex items-center gap-2 h-10 px-4 rounded-full bg-warn-bg text-warn text-sm font-medium hover:bg-warn-bg/80 transition-all disabled:opacity-60">
                <Edit3 className="w-4 h-4" /> {reopening ? 'Reopening...' : 'Edit Expense'}
              </button>
            )}
          </div>
        </div>
      </Card>

      {/* Budget Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="flex flex-col gap-2">
          <p className="text-xs text-ink-muted font-medium">Trip Status</p>
          <StatusPill status={tripFromNavActive?.status || 'Active'} />
        </Card>
        <Card className="flex flex-col gap-2">
          <p className="text-xs text-ink-muted font-medium">Total Budget</p>
          <p className="text-2xl font-bold text-ink">₹{budget.toLocaleString('en-IN')}</p>
        </Card>
        <Card className="flex flex-col gap-2">
          <p className="text-xs text-ink-muted font-medium">Total Spent</p>
          <p className="text-2xl font-bold text-ink">₹{spent.toLocaleString('en-IN')}</p>
        </Card>
        <Card className={`flex flex-col gap-2 ${overBudget ? 'border-err/30 bg-err-bg/30' : ''}`}>
          <p className="text-xs text-ink-muted font-medium">Remaining</p>
          <p className={`text-2xl font-bold ${overBudget ? 'text-err' : 'text-ok'}`}>
            ₹{remaining.toLocaleString('en-IN')}
          </p>
          {overBudget && <p className="text-xs text-err font-medium">Budget exceeded by ₹{Math.abs(remaining).toLocaleString('en-IN')}</p>}
        </Card>
      </div>

      {/* Category Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <h3 className="text-sm font-semibold text-ink mb-4">Category Breakdown</h3>
          {catData.length === 0 ? (
            <p className="text-sm text-ink-muted text-center py-8">No expense data yet. Add expenses to see breakdown.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={catData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #F0F0F0', fontSize: 12 }} />
                <Bar dataKey="amount" fill="#8b5cf6" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card>
          <h3 className="text-sm font-semibold text-ink mb-4">Category Totals</h3>
          {catData.length === 0 ? (
            <p className="text-sm text-ink-muted text-center py-8">No expenses yet.</p>
          ) : (
            <div className="space-y-3">
              {catData.map(({ label, amount }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-sm text-ink-muted">{label}</span>
                  <span className="text-sm font-semibold text-ink">₹{amount.toLocaleString('en-IN')}</span>
                </div>
              ))}
              <div className="pt-3 border-t border-line flex items-center justify-between">
                <span className="text-sm font-semibold text-ink">Total</span>
                <span className="text-sm font-bold text-brand">₹{spent.toLocaleString('en-IN')}</span>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Recent Expenses */}
      <Card>
        <h3 className="text-sm font-semibold text-ink mb-4">Recent Expenses ({s.expense_count || 0} total)</h3>
        {(!s.recent_expenses || s.recent_expenses.length === 0) ? (
          <div className="text-center py-8">
            <p className="text-sm text-ink-muted">No expenses recorded yet.</p>
            <button onClick={() => { if (!tripId) { toast.error('Trip ID is missing'); return; } navigate('/add-expense', { state: { tripId } }); }}
              className="mt-3 h-9 px-4 rounded-full text-sm font-medium text-brand bg-brand-50 hover:bg-brand-100">
              Add Your First Expense
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-canvas-soft text-ink-muted font-medium">
                <tr>
                  <th className="px-4 py-3 rounded-l-xl">Date</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Merchant</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3 rounded-r-xl">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(s.recent_expenses || []).map((exp, idx) => (
                  <tr key={exp.expense_id || `exp-${idx}-${exp.date || ''}-${exp.amount || 0}`}
                      onClick={() => setSelectedExpense(exp)}
                      className="hover:bg-brand-50/20 cursor-pointer transition-colors">
                    <td className="px-4 py-3 text-ink">{exp.date}</td>
                    <td className="px-4 py-3 text-ink">{exp.category}</td>
                    <td className="px-4 py-3 text-ink">{exp.merchant}</td>
                    <td className="px-4 py-3 font-medium text-ink">₹{((exp.amount_in_inr ?? exp.amount) || 0).toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3"><StatusPill status={exp.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Expense Detail Modal */}
      {selectedExpense && (() => {
        const exp = selectedExpense;
        const cat = (exp.category || '').toLowerCase();
        const transportType = cat === 'transportation' ? detectTransportType(exp) : null;

        let items = [];
        try {
          if (exp.items_json) {
            items = typeof exp.items_json === 'string' ? JSON.parse(exp.items_json) : exp.items_json;
            if (!Array.isArray(items)) items = [];
          }
        } catch { items = []; }

        const isFoodHotel = cat === 'food' || cat === 'hotel';
        const hasTravelFields = exp.from_location || exp.to_location || exp.departure_date || exp.seat_number;

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4"
               onClick={() => setSelectedExpense(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto"
                 onClick={e => e.stopPropagation()}>
              <div className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-brand-50 text-brand">
                      {exp.category}
                    </span>
                    <h3 className="text-lg font-semibold text-ink">{editMode ? editData.merchant || exp.merchant : exp.merchant || 'N/A'}</h3>
                  </div>
                  <div className="flex items-center gap-1">
                    {!editMode && (
                      <button onClick={() => {
                        setEditData({ ...exp, items_json: exp.items_json || '' });
                        let parsedItems = [];
                        try {
                          parsedItems = exp.items_json ? (typeof exp.items_json === 'string' ? JSON.parse(exp.items_json) : exp.items_json) : [];
                          if (!Array.isArray(parsedItems)) parsedItems = [];
                        } catch { parsedItems = []; }
                        setEditItems(parsedItems);
                        setEditMode(true);
                      }}
                        className="p-1.5 rounded-xl hover:bg-amber-50 text-ink-muted hover:text-warn transition-colors">
                        <Edit3 className="w-4 h-4" />
                      </button>
                    )}
                    <button onClick={() => { setSelectedExpense(null); setEditMode(false); }}
                      className="p-1.5 rounded-xl hover:bg-canvas-soft flex-shrink-0">
                      <XCircle className="w-5 h-5 text-ink-muted" />
                    </button>
                  </div>
                  </div>

                  {!editMode && exp.gstin && (
                    <div className="text-xs text-ink-muted">
                      <span className="font-medium">GSTIN:</span> {exp.gstin}
                    </div>
                  )}

                  {editMode ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-ink-muted mb-1">Merchant</label>
                          <input className="w-full h-9 px-3 rounded-xl border border-gray-200 text-sm text-ink focus:border-brand focus:ring-2 focus:ring-brand/15 outline-none"
                            value={editData.merchant || ''} onChange={e => setEditData({...editData, merchant: e.target.value})} />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-ink-muted mb-1">Amount</label>
                          <input type="number" className="w-full h-9 px-3 rounded-xl border border-gray-200 text-sm text-ink focus:border-brand focus:ring-2 focus:ring-brand/15 outline-none"
                            value={editData.amount || ''} onChange={e => setEditData({...editData, amount: e.target.value})} />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-ink-muted mb-1">Expense Date</label>
                          <input type="date" className="w-full h-9 px-3 rounded-xl border border-gray-200 text-sm text-ink focus:border-brand focus:ring-2 focus:ring-brand/15 outline-none"
                            value={editData.date || ''} onChange={e => setEditData({...editData, date: e.target.value})} />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-ink-muted mb-1">Tax</label>
                          <input type="number" className="w-full h-9 px-3 rounded-xl border border-gray-200 text-sm text-ink focus:border-brand focus:ring-2 focus:ring-brand/15 outline-none"
                            value={editData.tax || ''} onChange={e => setEditData({...editData, tax: e.target.value})} />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-ink-muted mb-1">SGST</label>
                          <input type="number" className="w-full h-9 px-3 rounded-xl border border-gray-200 text-sm text-ink focus:border-brand focus:ring-2 focus:ring-brand/15 outline-none"
                            value={editData.sgst || ''} onChange={e => setEditData({...editData, sgst: e.target.value})} />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-ink-muted mb-1">CGST</label>
                          <input type="number" className="w-full h-9 px-3 rounded-xl border border-gray-200 text-sm text-ink focus:border-brand focus:ring-2 focus:ring-brand/15 outline-none"
                            value={editData.cgst || ''} onChange={e => setEditData({...editData, cgst: e.target.value})} />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-ink-muted mb-1">GST</label>
                          <input type="number" className="w-full h-9 px-3 rounded-xl border border-gray-200 text-sm text-ink focus:border-brand focus:ring-2 focus:ring-brand/15 outline-none"
                            value={editData.gst || ''} onChange={e => setEditData({...editData, gst: e.target.value})} />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-ink-muted mb-1">GSTIN</label>
                          <input className="w-full h-9 px-3 rounded-xl border border-gray-200 text-sm text-ink focus:border-brand focus:ring-2 focus:ring-brand/15 outline-none"
                            value={editData.gstin || ''} onChange={e => setEditData({...editData, gstin: e.target.value})} />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-ink-muted mb-1">Invoice Number</label>
                          <input className="w-full h-9 px-3 rounded-xl border border-gray-200 text-sm text-ink focus:border-brand focus:ring-2 focus:ring-brand/15 outline-none"
                            value={editData.invoice_number || ''} onChange={e => setEditData({...editData, invoice_number: e.target.value})} />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-ink-muted mb-1">Items</label>
                        {editItems.length > 0 && (
                          <table className="w-full text-xs mb-2">
                            <thead>
                              <tr className="text-ink-muted border-b border-line">
                                <th className="text-left py-1 font-medium">Item</th>
                                <th className="text-center py-1 w-12 font-medium">Qty</th>
                                <th className="text-right py-1 w-16 font-medium">Unit</th>
                                <th className="text-right py-1 w-16 font-medium">Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {editItems.map((item, i) => (
                                <tr key={i} className="border-b border-line/30">
                                  <td className="py-0.5 pr-1">
                                    <input className="w-full h-7 px-1 rounded border border-gray-200 text-xs text-ink" value={item.name || ''}
                                      onChange={e => { const up = [...editItems]; up[i] = {...up[i], name: e.target.value}; setEditItems(up); }} />
                                  </td>
                                  <td className="py-0.5 px-0.5">
                                    <input type="number" className="w-full h-7 px-1 rounded border border-gray-200 text-xs text-ink text-center"
                                      value={item.quantity || 1}
                                      onChange={e => { const up = [...editItems]; up[i] = {...up[i], quantity: parseInt(e.target.value) || 1}; setEditItems(up); }} />
                                  </td>
                                  <td className="py-0.5 px-0.5">
                                    <input type="number" className="w-full h-7 px-1 rounded border border-gray-200 text-xs text-ink text-right"
                                      value={item.unit_price || 0}
                                      onChange={e => { const up = [...editItems]; up[i] = {...up[i], unit_price: parseFloat(e.target.value) || 0}; setEditItems(up); }} />
                                  </td>
                                  <td className="py-0.5 px-0.5">
                                    <input type="number" className="w-full h-7 px-1 rounded border border-gray-200 text-xs text-ink text-right"
                                      value={item.total_price || 0}
                                      onChange={e => { const up = [...editItems]; up[i] = {...up[i], total_price: parseFloat(e.target.value) || 0}; setEditItems(up); }} />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                        <button onClick={() => setEditItems([...editItems, { name: '', quantity: 1, unit_price: 0, total_price: 0 }])}
                          className="text-xs font-medium text-brand hover:text-brand-600">
                          + Add Item
                        </button>
                      </div>
                      <div className="flex gap-2 pt-2">
                        <button onClick={() => { setEditMode(false); }}
                          className="flex-1 h-10 rounded-full border border-gray-200 text-sm font-medium text-ink-muted hover:bg-canvas-soft transition-colors">
                          Cancel
                        </button>
                        <button onClick={handleSaveEdit} disabled={saving}
                          className="flex-1 h-10 rounded-full text-sm font-semibold text-white transition-all disabled:opacity-60"
                          style={{ background: 'linear-gradient(180deg,#5833EF 0%,#3A10CE 100%)', boxShadow: '0 4px 9px rgba(58,16,206,0.25)' }}>
                          {saving ? 'Saving...' : 'Save'}
                        </button>
                      </div>
                    </div>
                  ) : (
                  <div className="space-y-1.5">
                  {isFoodHotel && (<>
                    <InfoRow label="Date" value={exp.date} />
                    <InfoRow label="Time" value={exp.expense_time} />
                    {items.length > 0 && (
                      <div className="py-2">
                        <p className="text-xs font-semibold text-ink-muted mb-2 uppercase tracking-wide">Items</p>
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-ink-muted border-b border-line">
                              <th className="text-left py-1.5 font-medium">Item</th>
                              <th className="text-center py-1.5 font-medium">Qty</th>
                              <th className="text-right py-1.5 font-medium">Unit</th>
                              <th className="text-right py-1.5 font-medium">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((item, i) => (
                              <tr key={i} className="border-b border-line/50">
                                <td className="py-1.5 text-ink">{item.name || '-'}</td>
                                <td className="text-center py-1.5 text-ink">{item.quantity || 1}</td>
                                <td className="text-right py-1.5 text-ink">₹{((item.unit_price_inr ?? item.unit_price) || 0).toLocaleString('en-IN')}</td>
                                <td className="text-right py-1.5 text-ink font-medium">₹{((item.total_price_inr ?? item.total_price) || 0).toLocaleString('en-IN')}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {!items.length && (
                      <p className="text-xs text-ink-muted italic py-2">No itemized details available.</p>
                    )}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <InfoRow label="Tax" value={(() => { const tv = exp.gst_in_inr ?? exp.tax_in_inr ?? exp.tax; if (tv == null) return null; const n = parseFloat(tv); return n > 0 ? `₹${n.toLocaleString('en-IN')}` : '₹0'; })()} />
                    {exp.invoice_number && <InfoRow label="Invoice Number" value={exp.invoice_number} />}
                    <InfoRow label="SGST" value={exp.sgst > 0 ? `₹${parseFloat(exp.sgst_in_inr ?? exp.sgst).toLocaleString('en-IN')}` : null} />
                    {exp.status && <InfoRow label="Status" value={exp.status} />}
                    <InfoRow label="CGST" value={exp.cgst > 0 ? `₹${parseFloat(exp.cgst_in_inr ?? exp.cgst).toLocaleString('en-IN')}` : null} />
                    {(calcSubtotal(exp).totalTax > 0) && <InfoRow label="Subtotal Before Tax" value={`₹${calcSubtotal(exp).subtotal.toLocaleString('en-IN')}`} />}
                  </div>
                    <div className="pt-2 border-t border-line" />
                    <div className="flex justify-between items-center py-1.5">
                      <span className="text-xs font-semibold text-ink-muted">Final Total</span>
                      <span className="text-base font-bold text-brand">₹{((exp.amount_in_inr ?? exp.amount) || 0).toLocaleString('en-IN')}</span>
                    </div>
                  </>)}

                  {cat === 'transportation' && (hasTravelFields || transportType !== 'transport') && (() => {
                    const tt = transportType;
                    const travelFields = (
                      <div className="space-y-1.5">
                        {tt !== 'flight' && tt !== 'bus' && <InfoRow label="Railway / Train" value={exp.merchant} />}
                        {tt === 'flight' && <><InfoRow label="Airline" value={exp.merchant} />{exp.booking_reference && <InfoRow label="Booking Reference" value={exp.booking_reference} />}</>}
                        {tt === 'bus' && <InfoRow label="Bus Operator" value={exp.merchant} />}
                        {tt !== 'cab' && tt !== 'metro' && <><InfoRow label="From" value={exp.from_location} /><InfoRow label="To" value={exp.to_location} /></>}
                        {(tt === 'train' || tt === 'flight' || tt === 'bus') && <><InfoRow label="Journey / Departure Date" value={exp.departure_date} /><InfoRow label="Departure Time" value={exp.departure_time} /><InfoRow label="Arrival Date" value={exp.arrival_date} /><InfoRow label="Arrival Time" value={exp.arrival_time} /><InfoRow label="Seat / Coach" value={exp.seat_number} /></>}
                        <InfoRow label="Travel Class" value={exp.travel_class} />
                        {(tt === 'train' || tt === 'bus') && <InfoRow label="PNR / Reference" value={exp.booking_reference} />}
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                        <InfoRow label="Tax" value={(() => { const tv = exp.gst_in_inr ?? exp.tax_in_inr ?? exp.tax; if (tv == null) return null; const n = parseFloat(tv); return n > 0 ? `₹${n.toLocaleString('en-IN')}` : '₹0'; })()} />
                        {exp.invoice_number && <InfoRow label="Invoice Number" value={exp.invoice_number} />}
                        <InfoRow label="SGST" value={exp.sgst > 0 ? `₹${parseFloat(exp.sgst_in_inr ?? exp.sgst).toLocaleString('en-IN')}` : null} />
                        {exp.status && <InfoRow label="Status" value={exp.status} />}
                        <InfoRow label="CGST" value={exp.cgst > 0 ? `₹${parseFloat(exp.cgst_in_inr ?? exp.cgst).toLocaleString('en-IN')}` : null} />
                        {                                            (calcSubtotal(exp).totalTax > 0) && <InfoRow label="Subtotal Before Tax" value={`₹${calcSubtotal(exp).subtotal.toLocaleString('en-IN')}`} />}
                      </div>
                        <div className="pt-2 border-t border-line" />
                        <div className="flex justify-between items-center py-1.5">
                          <span className="text-xs font-semibold text-ink-muted">Amount</span>
                          <span className="text-base font-bold text-brand">₹{((exp.amount_in_inr ?? exp.amount) || 0).toLocaleString('en-IN')}</span>
                        </div>
                      </div>
                    );
                    return travelFields;
                  })()}

                  {cat === 'transportation' && !hasTravelFields && transportType === 'transport' && (<div className="space-y-1.5">
                    <InfoRow label="Date" value={exp.date} />
                    <div className="pt-2 border-t border-line" />
                    <div className="flex justify-between items-center py-1.5">
                      <span className="text-xs font-semibold text-ink-muted">Amount</span>
                      <span className="text-base font-bold text-brand">₹{((exp.amount_in_inr ?? exp.amount) || 0).toLocaleString('en-IN')}</span>
                    </div>
                  </div>)}

                  {cat === 'cab' && (<div className="space-y-1.5">
                    <InfoRow label="Cab Provider" value={exp.merchant} />
                    <InfoRow label="Pickup" value={exp.from_location} />
                    <InfoRow label="Drop" value={exp.to_location} />
                    <InfoRow label="Date" value={exp.date} />
                    <InfoRow label="Time" value={exp.expense_time} />
                    <InfoRow label="Trip Reference" value={exp.booking_reference} />
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <InfoRow label="Tax" value={(() => { const tv = exp.gst_in_inr ?? exp.tax_in_inr ?? exp.tax; if (tv == null) return null; const n = parseFloat(tv); return n > 0 ? `₹${n.toLocaleString('en-IN')}` : '₹0'; })()} />
                    {exp.invoice_number && <InfoRow label="Invoice Number" value={exp.invoice_number} />}
                    <InfoRow label="SGST" value={exp.sgst > 0 ? `₹${parseFloat(exp.sgst_in_inr ?? exp.sgst).toLocaleString('en-IN')}` : null} />
                    {exp.status && <InfoRow label="Status" value={exp.status} />}
                    <InfoRow label="CGST" value={exp.cgst > 0 ? `₹${parseFloat(exp.cgst_in_inr ?? exp.cgst).toLocaleString('en-IN')}` : null} />
                    {                                            (calcSubtotal(exp).totalTax > 0) && <InfoRow label="Subtotal Before Tax" value={`₹${calcSubtotal(exp).subtotal.toLocaleString('en-IN')}`} />}
                  </div>
                    <div className="pt-2 border-t border-line" />
                    <div className="flex justify-between items-center py-1.5">
                      <span className="text-xs font-semibold text-ink-muted">Fare</span>
                      <span className="text-base font-bold text-brand">₹{((exp.amount_in_inr ?? exp.amount) || 0).toLocaleString('en-IN')}</span>
                    </div>
                  </div>)}

                  {!isFoodHotel && cat !== 'transportation' && cat !== 'cab' && (<div className="space-y-1.5">
                    <InfoRow label="Merchant" value={exp.merchant} />
                    <InfoRow label="Date" value={exp.date} />
                    <InfoRow label="Time" value={exp.expense_time} />
                    <InfoRow label="Description" value={exp.description} />
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <InfoRow label="Tax" value={(() => { const tv = exp.gst_in_inr ?? exp.tax_in_inr ?? exp.tax; if (tv == null) return null; const n = parseFloat(tv); return n > 0 ? `₹${n.toLocaleString('en-IN')}` : '₹0'; })()} />
                    {exp.invoice_number && <InfoRow label="Invoice Number" value={exp.invoice_number} />}
                    <InfoRow label="SGST" value={exp.sgst > 0 ? `₹${parseFloat(exp.sgst_in_inr ?? exp.sgst).toLocaleString('en-IN')}` : null} />
                    {exp.status && <InfoRow label="Status" value={exp.status} />}
                    <InfoRow label="CGST" value={exp.cgst > 0 ? `₹${parseFloat(exp.cgst_in_inr ?? exp.cgst).toLocaleString('en-IN')}` : null} />
                    {                                            (calcSubtotal(exp).totalTax > 0) && <InfoRow label="Subtotal Before Tax" value={`₹${calcSubtotal(exp).subtotal.toLocaleString('en-IN')}`} />}
                  </div>
                    <div className="pt-2 border-t border-line" />
                    <div className="flex justify-between items-center py-1.5">
                      <span className="text-xs font-semibold text-ink-muted">Amount</span>
                      <span className="text-base font-bold text-brand">₹{((exp.amount_in_inr ?? exp.amount) || 0).toLocaleString('en-IN')}</span>
                    </div>
                  </div>)}
                </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
}