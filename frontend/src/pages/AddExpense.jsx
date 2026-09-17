import { useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Receipt, Upload, IndianRupee, FileText, Tag, Calendar, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { triggerWorkflow, readFileAsBase64, processReceiptReal, addExpenseReal } from '../services/api';
import { useAuth } from '../context/AuthContext';

const CATEGORIES = ['Transportation', 'Hotel', 'Food', 'Other'];

const SUBCATEGORIES = {
  Transportation: ['Flight', 'Train', 'Bus', 'Cab', 'Metro', 'Other Transportation'],
  Hotel: ['Room', 'Room Service', 'Breakfast', 'Lunch', 'Dinner', 'Laundry', 'Minibar', 'Other Hotel'],
  Food: ['Breakfast', 'Lunch', 'Dinner', 'Snacks', 'Beverages', 'Grocery', 'Other Food'],
  Other: ['Miscellaneous', 'Office', 'Personal', 'Other'],
};

function getSubcategoryPlaceholder(category) {
  return SUBCATEGORIES[category] ? `e.g. ${SUBCATEGORIES[category][0]}` : 'Select subcategory';
}

function Card({ children, className = '' }) {
  return <div className={`bg-white rounded-2xl border border-line shadow-card p-5 ${className}`}>{children}</div>;
}

function Input({ label, icon: Icon, ...props }) {
  return (
    <div className="space-y-1.5">
      {label && <label className="block text-sm font-medium text-ink-muted">{label}</label>}
      <div className="flex items-center gap-2.5 h-[48px] px-4 rounded-2xl bg-white/80 border border-gray-200 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15 transition-all">
        {Icon && <Icon className="w-5 h-5 text-gray-400 flex-shrink-0" />}
        {props.type === 'select' ? (
          <select className="flex-1 bg-transparent border-none outline-none text-ink text-sm" {...props}>
            {props.children}
          </select>
        ) : (
          <input className="flex-1 bg-transparent border-none outline-none text-ink placeholder:text-gray-400 text-sm" {...props} />
        )}
      </div>
    </div>
  );
}

export default function AddExpense() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const tripId = location.state?.tripId || '';
  const fileInputRef = useRef(null);

  const [mode, setMode] = useState('manual');
  const [loading, setLoading] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [extracted, setExtracted] = useState(null);
  const [receiptUrl, setReceiptUrl] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [source, setSource] = useState('manual');

  const [form, setForm] = useState({
    expense_date: '', category: '', subcategory: '', merchant: '',
    amount: '', currency: 'INR', payment_method: '', description: ''
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    const updated = { ...form, [name]: value };
    if (name === 'category' && form.subcategory) {
      const validSubs = SUBCATEGORIES[value] || [];
      if (!validSubs.includes(form.subcategory)) {
        updated.subcategory = '';
      }
    }
    setForm(updated);
  };

  // ─── Manual Submit ────────────────────────────────────────────
  const handleManualSubmit = async (e) => {
    e.preventDefault();
    if (!tripId) { toast.error('Trip ID is missing'); return; }
    if (!form.expense_date || !form.category || !form.amount) {
      toast.error('Please fill in date, category, and amount');
      return;
    }
    setLoading(true);
    try {
      const payload = {
        ...form,
        trip_id: tripId,
        user_id: user?.user_id || 'U001',
        amount: parseFloat(form.amount),
        source: source,
        receipt_url: receiptUrl,
      };

      // Merge detailed OCR fields into payload (OCR mode only)
      if (source === 'receipt' && extracted) {
        payload.expense_time     = extracted.time || '';
        payload.tax              = parseFloat(extracted.tax) || 0;
        payload.cgst             = parseFloat(extracted.cgst) || 0;
        payload.sgst             = parseFloat(extracted.sgst) || 0;
        payload.gst              = parseFloat(extracted.gst) || 0;
        payload.gstin            = extracted.gstin || '';
        payload.invoice_number   = extracted.invoice_number || '';
        payload.items            = extracted.items || [];
        if (extracted.travel_details) {
          const td = extracted.travel_details;
          payload.from_location      = td.from || '';
          payload.to_location        = td.to || '';
          payload.seat_number        = td.seat_number || '';
          payload.travel_class       = td.class || '';
          payload.booking_reference  = td.booking_reference || '';
          payload.departure_date     = td.departure_date || '';
          payload.departure_time     = td.departure_time || '';
          payload.arrival_date       = td.arrival_date || '';
          payload.arrival_time       = td.arrival_time || '';
        }
      }

      const res = await addExpenseReal(payload);
      if (res.success) {
        toast.success('Expense added successfully!');
        navigate('/trips', { state: { tripId } });
      } else {
        toast.error(res.error || 'Failed to add expense');
      }
    } catch (e) {
      toast.error(e.message || 'Failed to add expense');
    } finally {
      setLoading(false);
    }
  };

  // ─── File Selection ───────────────────────────────────────────
  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowed = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
    if (!allowed.includes(file.type)) {
      toast.error('Unsupported file format. Use JPG, PNG, or PDF.');
      return;
    }
    setSelectedFile(file);
    setExtracted(null);
  };

  // ─── OCR: Upload + Process ────────────────────────────────────
  const handleOcrUpload = async () => {
    if (!selectedFile) {
      toast.error('Please select a receipt file first');
      return;
    }
    setOcrLoading(true);
    setExtracted(null);
    try {
      const { base64, type, name } = await readFileAsBase64(selectedFile);
      const res = await processReceiptReal({
        file_data: base64,
        file_name: name,
        file_type: type,
      });
      if (res.success) {
        const ext = typeof res.extracted === 'string' ? JSON.parse(res.extracted) : res.extracted;
        setExtracted(ext);
        setReceiptUrl(res.receipt_url || '');
        setSource('receipt');
        setForm({
          ...form,
          merchant: ext.merchant || '',
          expense_date: ext.date || '',
          amount: (() => {
            const inr = parseFloat(ext.amount_in_inr) || 0;
            if (ext.currency && ext.currency !== 'INR' && inr > 0) {
              return String(inr);
            }
            return String(ext.amount || '');
          })(),
          category: (() => {
            const cat = (ext.category || '').trim().toLowerCase();
            if (cat === 'cab') return 'Transportation';
            return ext.category || 'Other';
          })(),
          ...(ext.category && ext.category.toLowerCase() === 'cab' ? { subcategory: 'Cab' } : {}),
        });
        toast.success('Receipt processed! Please review and edit details before adding.');
      } else {
        toast.error(res.error || 'OCR processing failed');
      }
    } catch (e) {
      toast.error(e.message || 'Receipt processing failed');
    } finally {
      setOcrLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Mode Toggle */}
      <Card>
        <div className="flex gap-2">
          <button onClick={() => setMode('manual')}
            className={`flex-1 flex items-center justify-center gap-2 h-10 rounded-full text-sm font-medium transition-all
              ${mode === 'manual' ? 'bg-brand-50 text-brand' : 'text-ink-muted hover:bg-canvas-soft'}`}>
            <FileText className="w-4 h-4" /> Manual Entry
          </button>
          <button onClick={() => setMode('receipt')}
            className={`flex-1 flex items-center justify-center gap-2 h-10 rounded-full text-sm font-medium transition-all
              ${mode === 'receipt' ? 'bg-brand-50 text-brand' : 'text-ink-muted hover:bg-canvas-soft'}`}>
            <Upload className="w-4 h-4" /> Upload Receipt
          </button>
        </div>
      </Card>

      {/* Receipt Upload Section */}
      {mode === 'receipt' && (
        <Card>
          <div className="text-center py-6 space-y-4">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-brand-50 flex items-center justify-center">
              <Upload className="w-8 h-8 text-brand" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink">Upload Receipt</h3>
              <p className="text-xs text-ink-muted mt-1">JPG, PNG, or PDF supported</p>
            </div>
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,application/pdf"
              onChange={handleFileSelect} className="hidden" />
            <div onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-6 cursor-pointer transition-colors
                ${selectedFile ? 'border-brand/40 bg-brand-50/30' : 'border-line hover:border-brand/30'}`}>
              {selectedFile ? (
                <p className="text-sm text-brand font-medium">{selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)</p>
              ) : (
                <p className="text-xs text-ink-muted">Click to select a receipt file</p>
              )}
            </div>
            <button onClick={handleOcrUpload} disabled={ocrLoading || !selectedFile}
              className="h-10 px-6 rounded-full text-sm font-medium text-white transition-all disabled:opacity-60 flex items-center gap-2 mx-auto"
              style={{ background: 'linear-gradient(180deg,#5833EF 0%,#3A10CE 100%)' }}>
              {ocrLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</> : <><Upload className="w-4 h-4" /> Process Receipt</>}
            </button>
          </div>
        </Card>
      )}

      {/* OCR Results */}
      {extracted && (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-ok-bg flex items-center justify-center">
              <Receipt className="w-4 h-4 text-ok" />
            </div>
            <p className="text-sm font-medium text-ok">Data extracted — please verify</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(() => {
              const e = extracted || {};
              const cur = e.currency || '';
              const origins = e.amount || 0;
              const inr = e.amount_in_inr || 0;
              const xrate = e.exchange_rate || 0;
              const fields = [
                { k: 'merchant',        v: e.merchant || '-' },
                { k: 'date',            v: e.date || '-' },
                { k: 'original amount', v: cur ? `${origins} ${cur}` : (origins || '-') },
                { k: 'currency',        v: cur || '-' },
                { k: 'exchange rate',   v: xrate > 0 ? xrate : '-' },
                { k: 'inr amount',      v: inr > 0 ? `₹${parseFloat(inr).toLocaleString('en-IN')}` : '-' },
                { k: 'tax',             v: e.tax || '-' },
                { k: 'invoice number',  v: e.invoice_number || '-' },
                { k: 'category',        v: e.category || '-' },
              ];
              return fields.map(({ k, v }) => (
                <div key={k} className="bg-canvas-soft rounded-xl p-2.5">
                  <p className="text-[10px] text-ink-muted uppercase">{k.replace('_', ' ')}</p>
                  <p className="text-sm font-medium text-ink">{v}</p>
                </div>
              ));
            })()}
          </div>
        </Card>
      )}

      {/* Expense Form */}
      <Card>
        <form onSubmit={handleManualSubmit} className="space-y-4">
          <Input label="Expense Date" name="expense_date" type="date" value={form.expense_date} onChange={handleChange} icon={Calendar} required />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Category" name="category" type="select" value={form.category} onChange={handleChange} icon={Tag} required>
              <option value="">Select</option>
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </Input>
            <Input label="Subcategory" name="subcategory" type="select" placeholder={getSubcategoryPlaceholder(form.category)} value={form.subcategory} onChange={handleChange} icon={Tag}>
              <option value="">{getSubcategoryPlaceholder(form.category)}</option>
              {(SUBCATEGORIES[form.category] || []).map(s => <option key={s}>{s}</option>)}
            </Input>
          </div>
          <Input label="Merchant / Vendor" name="merchant" placeholder="e.g. ABC Restaurant" value={form.merchant} onChange={handleChange} icon={FileText} />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Amount (₹)" name="amount" type="number" placeholder="450" value={form.amount} onChange={handleChange} icon={IndianRupee} required />
            <Input label="Payment Method" name="payment_method" placeholder="e.g. UPI" value={form.payment_method} onChange={handleChange} icon={FileText} />
          </div>
          <Input label="Description" name="description" placeholder="e.g. Client lunch" value={form.description} onChange={handleChange} icon={FileText} />

          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={loading}
              className="flex-1 h-[48px] flex items-center justify-center gap-2 rounded-full text-sm font-semibold text-white transition-all disabled:opacity-60"
              style={{ background: 'linear-gradient(180deg,#5833EF 0%,#3A10CE 100%)', boxShadow: '0 4px 9px rgba(58,16,206,0.25)' }}>
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : 'Add Expense'}
            </button>
            <button type="button" onClick={() => navigate('/trips', { state: { tripId } })}
              className="h-[48px] px-6 flex items-center justify-center rounded-full border border-gray-200 text-sm font-medium text-ink-muted hover:bg-canvas-soft transition-all">
              Cancel
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}