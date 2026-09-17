import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plane, Wallet, TrendingUp, AlertTriangle, Plus } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useAuth } from '../context/AuthContext';
import { triggerWorkflow } from '../services/api';

function Card({ children, className = '', onClick }) {
  return (
    <div onClick={onClick}
      className={`bg-white rounded-2xl border border-line shadow-card p-5 transition-shadow
        ${onClick ? 'cursor-pointer hover:shadow-card-hover' : ''} ${className}`}>
      {children}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, trend, color = 'brand' }) {
  const colors = { brand: 'bg-brand-50 text-brand', ok: 'bg-ok-bg text-ok', warn: 'bg-warn-bg text-warn', err: 'bg-err-bg text-err' };
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${colors[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
        {trend != null && (
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${trend >= 0 ? 'bg-ok-bg text-ok' : 'bg-err-bg text-err'}`}>
            {trend >= 0 ? '+' : ''}{trend}
          </span>
        )}
      </div>
      <div className="mt-3">
        <h3 className="text-3xl font-bold text-ink leading-tight">{value}</h3>
        <p className="text-sm text-ink-muted mt-1">{label}</p>
      </div>
    </Card>
  );
}

function StatusPill({ status }) {
  const map = {
    Active: 'bg-ok-bg text-ok', Draft: 'bg-off-bg text-off',
    Completed: 'bg-brand-50 text-brand', Cancelled: 'bg-err-bg text-err',
  };
  return <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${map[status] || 'bg-off-bg text-off'}`}>{status}</span>;
}

function Skeleton({ h = 32 }) {
  return <div className={`bg-white rounded-2xl h-${h} animate-pulse`} />;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchTrips = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await triggerWorkflow('list_trips', { user_id: user?.user_id || 'USR-1001' });
      if (res.success) {
        const raw = typeof res.trips === 'string' ? JSON.parse(res.trips) : (res.trips || []);
        setTrips(raw);
      } else {
        setError(res.error || 'Failed to load trips');
      }
    } catch (e) {
      setError(e.message || 'Failed to load trips');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTrips(); }, [user]);

  const activeTrips = trips.filter(t => t.status === 'Active');
  const completedTrips = trips.filter(t => t.status === 'Completed');
  const totalSpent = 0; // Will come from individual trip summaries

  const chartData = [
    { label: 'Transport', amount: 4500 },
    { label: 'Hotel', amount: 3000 },
    { label: 'Food', amount: 1850 },
    { label: 'Other', amount: 900 },
  ];

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="bg-white rounded-2xl h-32 animate-pulse" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-err-bg border border-err/20 rounded-2xl">
          <span className="text-xs font-medium text-err">{error}</span>
          <button onClick={fetchTrips} className="text-xs text-err/60 hover:text-err ml-2">Retry</button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Plane} label="Active Trips" value={activeTrips.length} color="brand" />
        <StatCard icon={Wallet} label="Total Trips" value={trips.length} color="ok" />
        <StatCard icon={TrendingUp} label="Completed" value={completedTrips.length} color="brand" />
        <StatCard icon={AlertTriangle} label="Budget Alerts" value="0" color="warn" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-ink">Active Trips</h3>
              <button onClick={() => navigate('/trips/new')}
                className="flex items-center gap-1.5 text-xs font-medium text-brand hover:text-brand-600">
                <Plus className="w-3.5 h-3.5" /> New Trip
              </button>
            </div>
            {activeTrips.length === 0 ? (
              <p className="text-sm text-ink-muted text-center py-8">No active trips. Create one to get started.</p>
            ) : (
              <div className="space-y-2">
                {activeTrips.map(trip => (
                  <div key={trip.trip_id} onClick={() => navigate('/trips', { state: { tripId: trip.trip_id, trip } })}
                    className="flex items-center justify-between p-3 rounded-xl hover:bg-canvas-soft cursor-pointer transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center">
                        <Plane className="w-5 h-5 text-brand" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-ink">{trip.trip_name}</p>
                        <p className="text-xs text-ink-muted">{trip.destination} · {trip.start_date} — {trip.end_date}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-ink">₹{(trip.budget || 0).toLocaleString('en-IN')}</span>
                      <StatusPill status={trip.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <h3 className="text-sm font-semibold text-ink mb-4">Category Breakdown (Sample)</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #F0F0F0', fontSize: 12 }} />
                <Bar dataKey="amount" fill="#8b5cf6" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <h3 className="text-sm font-semibold text-ink mb-3">Completed Trips</h3>
            {completedTrips.length === 0 ? (
              <p className="text-xs text-ink-muted py-4 text-center">No completed trips yet.</p>
            ) : (
              <div className="space-y-2">
                {completedTrips.map(trip => (
                  <div key={trip.trip_id} onClick={() => navigate('/reports')}
                    className="flex items-center gap-3 p-2 rounded-xl hover:bg-canvas-soft cursor-pointer">
                    <div className="w-8 h-8 rounded-lg bg-ok-bg flex items-center justify-center">
                      <Plane className="w-4 h-4 text-ok" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-ink truncate">{trip.trip_name}</p>
                      <p className="text-[10px] text-ink-muted">{trip.destination}</p>
                    </div>
                    <StatusPill status={trip.status} />
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <h3 className="text-sm font-semibold text-ink mb-3">Quick Actions</h3>
            <div className="space-y-2">
              <button onClick={() => navigate('/trips/new')}
                className="w-full flex items-center gap-2.5 p-2.5 rounded-xl hover:bg-brand-50 text-sm text-brand font-medium transition-colors">
                <Plus className="w-4 h-4" /> Create New Trip
              </button>
              <button onClick={() => navigate('/trips')}
                className="w-full flex items-center gap-2.5 p-2.5 rounded-xl hover:bg-canvas-soft text-sm text-ink-muted font-medium transition-colors">
                <Plane className="w-4 h-4" /> View All Trips
              </button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}